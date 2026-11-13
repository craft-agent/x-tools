import { afterEach, describe, expect, test } from "bun:test"
import { failureOf } from "./cookies.testing"
import { removeTempDirs } from "./engine.testing"
import { MINUTE_MS, FINGERPRINT, OTHER_FINGERPRINT, T0, failedReply, okReply, pacedFixture } from "./paced-call.testing"

afterEach(removeTempDirs)

const iso = (time: number) => new Date(time).toISOString()

const INACTIVE = { active: false, error: "account suspended", locks: {} }
const ACTIVE = { active: true, error: null, locks: {} }

describe("pacedCall remembers a refused session", () => {
  test("an inactive session is stored by its fingerprint, and the next read of these cookies is refused", async () => {
    const fixture = await pacedFixture(failedReply("no_account", true, INACTIVE))
    const reply = await fixture.run()
    expect(reply).toMatchObject({ ok: false, kind: "no_account" })
    expect((await fixture.state()).refused).toEqual({
      fingerprint: FINGERPRINT,
      error: "account suspended",
      at: iso(T0),
    })

    const error = await failureOf(fixture.run())
    expect(error.code).toBe("unauthenticated")
    expect(error.details).toEqual({ reason: "refused", refused_at: iso(T0) })
    expect(fixture.refusedArguments).toHaveLength(1)
    expect((await fixture.state()).calls).toEqual([T0])
  })

  test("the reply's fingerprint wins; without one the call's is stored", async () => {
    const fixture = await pacedFixture({ ...failedReply("no_account", true, INACTIVE), fingerprint: OTHER_FINGERPRINT })
    await fixture.run()
    expect((await fixture.state()).refused?.fingerprint).toBe(OTHER_FINGERPRINT)

    const bare = await pacedFixture({ ...failedReply("no_account", true, INACTIVE), fingerprint: null })
    await bare.run()
    expect((await bare.state()).refused?.fingerprint).toBe(FINGERPRINT)
  })

  test("new cookies go through, and an active session clears the memory", async () => {
    const fixture = await pacedFixture(okReply(true, ACTIVE))
    await fixture.seed({ refused: { fingerprint: OTHER_FINGERPRINT, error: "old", at: iso(T0 - MINUTE_MS) } })
    await fixture.run()
    expect(fixture.refusedArguments).toEqual([OTHER_FINGERPRINT])
    expect((await fixture.state()).refused).toBeNull()
  })

  test("a reply without a session leaves the memory as it was", async () => {
    const fixture = await pacedFixture(okReply(false))
    const refused = { fingerprint: OTHER_FINGERPRINT, error: "old", at: iso(T0 - MINUTE_MS) }
    await fixture.seed({ refused, rate_limited_until: iso(T0 - MINUTE_MS) })
    await fixture.run()
    expect(await fixture.state()).toEqual({ calls: [], refused, rate_limited_until: iso(T0 - MINUTE_MS) })
  })
})

describe("pacedCall remembers X's rate limit", () => {
  test("a lock still ahead is stored, refuses every read until it passes, then reads again", async () => {
    const until = T0 + 10 * MINUTE_MS
    const fixture = await pacedFixture(
      failedReply("no_account", true, { active: true, error: null, locks: { search: iso(until) } }),
    )
    await fixture.run()
    expect((await fixture.state()).rate_limited_until).toBe(iso(until))

    fixture.clock.time = until - 1
    const error = await failureOf(fixture.run())
    expect(error.code).toBe("rate_limited")
    expect(error.details).toEqual({ reason: "x_rate_limit", retry_at: iso(until) })
    expect(fixture.refusedArguments).toHaveLength(1)

    fixture.clock.time = until
    await fixture.engine.reply(okReply(true, ACTIVE))
    await fixture.run()
    expect(fixture.refusedArguments).toHaveLength(2)
    expect((await fixture.state()).rate_limited_until).toBeNull()
  })

  test("the latest of several locks is stored; one that has passed is not", async () => {
    const locks = { a: iso(T0 + 5 * MINUTE_MS), b: iso(T0 + 20 * MINUTE_MS), c: iso(T0 - MINUTE_MS) }
    const fixture = await pacedFixture(okReply(true, { active: true, error: null, locks }))
    await fixture.run()
    expect((await fixture.state()).rate_limited_until).toBe(iso(T0 + 20 * MINUTE_MS))

    const past = await pacedFixture(okReply(true, { active: true, error: null, locks: { c: iso(T0 - MINUTE_MS) } }))
    await past.seed({ rate_limited_until: iso(T0 - 2 * MINUTE_MS) })
    await past.run()
    expect((await past.state()).rate_limited_until).toBeNull()
  })

  test("a session that has no locks clears a limit that was stored", async () => {
    const fixture = await pacedFixture(okReply(true, ACTIVE))
    await fixture.seed({ rate_limited_until: iso(T0 - MINUTE_MS) })
    await fixture.run()
    expect((await fixture.state()).rate_limited_until).toBeNull()
  })

  test("a lock that cannot be read as a time is ignored", async () => {
    const fixture = await pacedFixture(okReply(true, { active: true, error: null, locks: { a: "soon" } }))
    await fixture.run()
    expect((await fixture.state()).rate_limited_until).toBeNull()
  })
})
