import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { isAbortError, isToolError } from "../errors"
import { tryReadLock } from "../x/read-lock"
import { clientFixture, type ClientFixture } from "./client.testing"
import { T0, TEST_USER_AGENT, rejected, waitUntil } from "./fxtwitter.testing"
import { DEFAULT_FX_PACE, fxPaths } from "./pacing"

let fx: ClientFixture

beforeEach(async () => {
  fx = await clientFixture()
  fx.fake.route("/2/status/1", { status: 200, body: { id: "1" } })
})

afterEach(() => fx.dispose())

describe("createFxClient", () => {
  test("returns the reply as it is", async () => {
    expect(await fx.client().get("/2/status/1")).toEqual({ status: 200, retryAfter: null, body: { id: "1" } })
    expect(fx.fake.requests[0]!.headers["user-agent"]).toBe(TEST_USER_AGENT)
  })

  test("a 404 or a 401 is a success that resets the failures", async () => {
    fx.fake.route("/2/status/404", { status: 404, body: { code: 404 } })
    fx.fake.route("/2/status/401", { status: 401, body: { code: 401 } })
    fx.fake.route("/2/status/500", { status: 500, body: {} })
    const client = fx.client()
    await rejected(client.get("/2/status/500"))
    expect(client.failures()).toBe(1)
    expect((await client.get("/2/status/404")).status).toBe(404)
    expect((await client.get("/2/status/401")).status).toBe(401)
    expect(client.failures()).toBe(0)
  })

  test("waits out the gap between two requests, and not before the first", async () => {
    const client = fx.client()
    await client.get("/2/status/1")
    expect(fx.sleeps).toEqual([])
    await client.get("/2/status/1")
    expect(fx.sleeps).toEqual([DEFAULT_FX_PACE.gapMs])
    expect((await fx.state()).calls).toEqual([T0, T0 + DEFAULT_FX_PACE.gapMs])
  })

  test("does not wait when the gap has already passed", async () => {
    await fx.seed({ calls: [T0 - 10_000] })
    await fx.client().get("/2/status/1")
    expect(fx.sleeps).toEqual([])
  })

  test("counts every request sent, whatever it came to", async () => {
    fx.fake.route("/2/status/500", { status: 500, body: {} })
    fx.fake.route("/2/status/429", { status: 429, body: {} })
    fx.fake.route("/2/status/slow", { status: 200, body: {}, delayMs: 2_000 })
    await rejected(fx.client().get("/2/status/500"))
    await fx.client().get("/2/status/1")
    await rejected(fx.client({ timeoutMs: 30 }).get("/2/status/slow"))
    await rejected(fx.client().get("/2/status/429"))
    expect(fx.fake.requests).toHaveLength(4)
    expect((await fx.state()).calls).toHaveLength(4)
  })

  test("records the request before it is sent", async () => {
    fx.fake.route("/2/status/slow", { status: 200, body: {}, delayMs: 2_000 })
    const pending = rejected(fx.client({ timeoutMs: 2_000, signal: AbortSignal.timeout(500) }).get("/2/status/slow"))
    await waitUntil(() => fx.fake.requests.length > 0)
    expect((await fx.state()).calls).toEqual([T0])
    await pending
  })

  test("an abort during the gap counts nothing", async () => {
    await fx.seed({ calls: [T0] })
    const controller = new AbortController()
    const client = fx.client({
      signal: controller.signal,
      sleep: async (_ms, signal) => {
        controller.abort()
        signal?.throwIfAborted()
      },
    })
    expect(isAbortError(await rejected(client.get("/2/status/1")))).toBe(true)
    expect(fx.fake.requests).toEqual([])
    expect((await fx.state()).calls).toEqual([T0])
    expect(client.failures()).toBe(0)
  })

  test("an abort during the request is no failure, but the request counted", async () => {
    fx.fake.route("/2/status/slow", { status: 200, body: {}, delayMs: 2_000 })
    const controller = new AbortController()
    const client = fx.client({ signal: controller.signal })
    const pending = rejected(client.get("/2/status/slow"))
    await waitUntil(() => fx.fake.requests.length > 0)
    controller.abort()
    expect(isAbortError(await pending)).toBe(true)
    expect(client.failures()).toBe(0)
    expect((await fx.state()).calls).toEqual([T0])
  })

  test("refuses past the daily cap without a request", async () => {
    const calls = [T0 - 3_000, T0 - 2_000, T0 - 1_000]
    await fx.seed({ calls })
    const error = await rejected(fx.client({ settings: { ...DEFAULT_FX_PACE, perDay: 3 } }).get("/2/status/1"))
    expect(isToolError(error) && error.code).toBe("rate_limited")
    expect(isToolError(error) && error.details?.reason).toBe("fxtwitter_daily_cap")
    expect(fx.fake.requests).toEqual([])
    expect((await fx.state()).calls).toEqual(calls)
  })

  test("a path outside /2/ is refused before anything is touched", async () => {
    const error = await rejected(fx.client().get("/status/1"))
    expect(isToolError(error) && error.code).toBe("internal_error")
    expect(existsSync(fxPaths(fx.stateDir).dir)).toBe(false)
  })
})

describe("FxTwitter's state on disk", () => {
  test("holds only the request times and the cooldown, in private files", async () => {
    await fx.client().get("/2/status/1?secret=value")
    const paths = fxPaths(fx.stateDir)
    const text = await readFile(paths.pacing, "utf8")
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["calls", "cooldown_until"])
    expect(text).not.toContain("status")
    expect(text).not.toContain("secret")
    expect(text).not.toContain("id")
    expect(statSync(paths.pacing).mode & 0o777).toBe(0o600)
    expect(statSync(paths.dir).mode & 0o777).toBe(0o700)
    expect(statSync(fx.stateDir).mode & 0o777).toBe(0o700)
    expect(statSync(paths.lock).mode & 0o777).toBe(0o600)
    expect(paths.dir).toBe(join(fx.stateDir, "fxtwitter"))
  })
})

describe("the lock", () => {
  test("two clients in one process never have two requests open at once", async () => {
    fx.fake.route("/2/status/1", { status: 200, body: {}, delayMs: 60 })
    const [first, second] = await Promise.all([fx.client().get("/2/status/1"), fx.client().get("/2/status/1")])
    expect([first.status, second.status]).toEqual([200, 200])
    expect(fx.fake.requests).toHaveLength(2)
    expect(fx.fake.stats.maxInFlight).toBe(1)
    expect((await fx.state()).calls).toHaveLength(2)
  })

  test("a lock held past the wait is rate_limited, worded for FxTwitter", async () => {
    await fx.seed({})
    const release = tryReadLock(fxPaths(fx.stateDir).lock)
    try {
      const error = await rejected(fx.client({ lockWaitMs: 20 }).get("/2/status/1"))
      expect(isToolError(error) && error.code).toBe("rate_limited")
      expect(isToolError(error) && error.message).toBe("Another read of FxTwitter is still running; try again shortly.")
      expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "read_lock" })
      expect(fx.fake.requests).toEqual([])
    } finally {
      release?.()
    }
  })
})
