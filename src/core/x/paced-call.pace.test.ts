import { afterEach, describe, expect, test } from "bun:test"
import { failureOf } from "./cookies.testing"
import { callEngine } from "./engine-call"
import { removeTempDirs } from "./engine.testing"
import { FINGERPRINT, MINUTE_MS, OTHER_FINGERPRINT, T0, okReply, pacedFixture, pacingText } from "./paced-call.testing"
import { DAY_MS, DEFAULT_PACE, HOUR_MS } from "./pacing"

afterEach(removeTempDirs)

describe("pacedCall's gap", () => {
  test("the first read goes at once; the next waits out the gap and then reads", async () => {
    const fixture = await pacedFixture()
    await fixture.run()
    expect(fixture.sleeps).toEqual([])
    await fixture.run()
    expect(fixture.sleeps).toEqual([DEFAULT_PACE.gapSeconds * 1000])
    expect(fixture.refusedArguments).toEqual([null, null])
    expect((await fixture.state()).calls).toEqual([T0, T0 + 5000])
  })

  test("a read after the gap does not wait", async () => {
    const fixture = await pacedFixture()
    await fixture.run()
    fixture.clock.time += 5000
    await fixture.run()
    expect(fixture.sleeps).toEqual([])
  })

  test("an abort while waiting out the gap counts nothing and calls nothing", async () => {
    const fixture = await pacedFixture()
    await fixture.run()
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" })
    const error = await fixture.run({ sleep: () => Promise.reject(abort) }).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBe(abort)
    expect(fixture.refusedArguments).toHaveLength(1)
    expect((await fixture.state()).calls).toEqual([T0])
  })

  test("an abort that an injected sleep ignores still stops the call", async () => {
    const fixture = await pacedFixture()
    await fixture.run()
    const controller = new AbortController()
    const error = await fixture
      .run({
        signal: controller.signal,
        sleep: async () => controller.abort(),
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      )
    expect((error as Error).name).toBe("AbortError")
    expect(fixture.refusedArguments).toHaveLength(1)
    expect((await fixture.state()).calls).toEqual([T0])
  })
})

describe("pacedCall's caps", () => {
  test("the hourly cap refuses without calling the engine or counting", async () => {
    const fixture = await pacedFixture(okReply(true), { gapSeconds: 5, perHour: 2, perDay: 200 })
    const calls = [T0 - 30 * MINUTE_MS, T0 - 10 * MINUTE_MS]
    await fixture.seed({ calls })
    const error = await failureOf(fixture.run())
    expect(error.code).toBe("rate_limited")
    expect(error.details).toEqual({ reason: "hourly_cap", retry_at: new Date(calls[0]! + HOUR_MS).toISOString() })
    expect(fixture.refusedArguments).toEqual([])
    expect(fixture.sleeps).toEqual([])
    expect((await fixture.state()).calls).toEqual(calls)
  })

  test("the daily cap refuses without calling the engine", async () => {
    const fixture = await pacedFixture(okReply(true), { gapSeconds: 5, perHour: 30, perDay: 2 })
    const calls = [T0 - 5 * HOUR_MS, T0 - 3 * HOUR_MS]
    await fixture.seed({ calls })
    const error = await failureOf(fixture.run())
    expect(error.details).toEqual({ reason: "daily_cap", retry_at: new Date(calls[0]! + DAY_MS).toISOString() })
    expect(fixture.refusedArguments).toEqual([])
  })

  test("reads older than 24 hours are dropped from the state when a read is counted", async () => {
    const fixture = await pacedFixture()
    await fixture.seed({ calls: [T0 - DAY_MS - 1, T0 - DAY_MS, T0 - HOUR_MS] })
    await fixture.run()
    expect((await fixture.state()).calls).toEqual([T0 - HOUR_MS, T0])
  })

  test("a cap that clears with time lets the read through", async () => {
    const fixture = await pacedFixture(okReply(true), { gapSeconds: 5, perHour: 1, perDay: 200 })
    await fixture.run()
    await failureOf(fixture.run())
    fixture.clock.time += HOUR_MS
    await fixture.run()
    expect(fixture.refusedArguments).toHaveLength(2)
  })
})

describe("pacedCall's remembered refusal", () => {
  const refusal = { fingerprint: FINGERPRINT, error: "suspended", at: new Date(T0 - MINUTE_MS).toISOString() }

  test("the same cookies are refused without calling the engine or counting", async () => {
    const fixture = await pacedFixture()
    await fixture.seed({ refused: refusal })
    const error = await failureOf(fixture.run())
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe("X refused this reading account's session; sign in again with fresh cookies.")
    expect(error.details).toEqual({ reason: "refused", refused_at: refusal.at })
    expect(fixture.refusedArguments).toEqual([])
    expect(await fixture.state()).toEqual({ calls: [], refused: refusal, rate_limited_until: null })
  })

  test("other cookies go through, with the earlier fingerprint handed to the engine", async () => {
    const fixture = await pacedFixture()
    await fixture.seed({ refused: { ...refusal, fingerprint: OTHER_FINGERPRINT } })
    await fixture.run()
    expect(fixture.refusedArguments).toEqual([OTHER_FINGERPRINT])
  })

  test("the refusal is checked before the caps and the gap", async () => {
    const fixture = await pacedFixture(okReply(true), { gapSeconds: 5, perHour: 1, perDay: 1 })
    await fixture.seed({ refused: refusal, calls: [T0] })
    expect((await failureOf(fixture.run())).details?.reason).toBe("refused")
  })
})

describe("pacedCall's lock", () => {
  test("two calls on one label never overlap and both count", async () => {
    const fixture = await pacedFixture()
    let running = 0
    let overlapped = false
    const call = async (refused: string | null) => {
      running += 1
      overlapped ||= running > 1
      try {
        fixture.refusedArguments.push(refused)
        return await callEngine(fixture.engineOptions(refused))
      } finally {
        running -= 1
      }
    }
    await Promise.all([fixture.run({ call }), fixture.run({ call })])
    expect(overlapped).toBe(false)
    expect(fixture.refusedArguments).toHaveLength(2)
    expect((await fixture.state()).calls).toHaveLength(2)
  })

  test("the lock is free again after a refusal and after a failed call", async () => {
    const fixture = await pacedFixture()
    await fixture.seed({ refused: { fingerprint: FINGERPRINT, error: null, at: new Date(T0).toISOString() } })
    await failureOf(fixture.run())
    await fixture.seed({})
    const boom = new Error("boom")
    await expect(fixture.run({ call: () => Promise.reject(boom) })).rejects.toBe(boom)
    await fixture.run({ lockWaitMs: 0 })
    expect(fixture.refusedArguments).toHaveLength(1)
  })

  test("a lock held past lockWaitMs is rate_limited", async () => {
    const fixture = await pacedFixture()
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const slow = fixture.run({
      call: async () => {
        await held
        return okReply(true)
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const error = await failureOf(fixture.run({ lockWaitMs: 1 }))
    expect(error.code).toBe("rate_limited")
    expect(error.details).toEqual({ reason: "read_lock" })
    release()
    await slow
  })

  test("the state file holds no cookie value", async () => {
    const fixture = await pacedFixture()
    await fixture.run()
    const text = await pacingText(fixture)
    expect(text).not.toContain("authsecret")
    expect(text).not.toContain("ctzerosecret")
  })
})
