import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { fxPaths } from "../fxtwitter/pacing"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { removeTempDirs } from "../x/engine.testing"
import { ensurePrivateDir } from "../x/private-dir"
import { DEFAULT_LOCK_WAIT_MS, tryReadLock } from "../x/read-lock"
import { CALL_BUDGET_MS, createReader } from "./reader"
import {
  ACCOUNT_ANSWER,
  BRIDGE_FILE,
  OWN_DIR,
  USER_AGENT,
  sourcesFixture,
  thrown,
  type SourcesFixture,
} from "./sources.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const BUDGET_ERROR = {
  code: "rate_limited",
  message: "This call ran out of its time before it could read this; ask again for what is left.",
  details: { reason: "call_budget" },
}

describe("createReader: the call's time budget", () => {
  test("is 150 s from the moment the reader is made", () => {
    expect(CALL_BUDGET_MS).toBe(150_000)
    const reader = h.reader()
    expect(reader.remainingMs()).toBe(CALL_BUDGET_MS)
    h.clock.time += 40_000
    expect(reader.remainingMs()).toBe(CALL_BUDGET_MS - 40_000)
    expect(() => reader.checkBudget()).not.toThrow()
  })

  test("refuses with rate_limited once nothing is left, and never counts below 0", () => {
    const reader = h.reader(undefined, { budgetMs: 1000 })
    h.clock.time += 999
    expect(() => reader.checkBudget()).not.toThrow()
    h.clock.time += 5000
    expect(reader.remainingMs()).toBe(0)
    expect(thrown(() => reader.checkBudget())).toMatchObject(BUDGET_ERROR)
  })

  test("refuses a request to FxTwitter once spent, without sending it", async () => {
    h.fake.route("/2/status/1", { status: 200, body: { code: 200 } })
    const reader = h.reader(undefined, { budgetMs: 1000 })
    expect((await reader.fxtwitter().get("/2/status/1")).status).toBe(200)
    h.clock.time += 1000
    expect(await rejected(reader.fxtwitter().get("/2/status/1"))).toMatchObject(BUDGET_ERROR)
    expect(h.fake.requests).toHaveLength(1)
  })

  test("refuses a read of the reading account once spent, without making it", async () => {
    const reader = h.reader(undefined, { budgetMs: 1000 })
    expect(await reader.account("check", {})).toEqual(ACCOUNT_ANSWER)
    h.clock.time += 1000
    expect(await rejected(reader.account("check", {}))).toMatchObject(BUDGET_ERROR)
    expect(h.accountReads).toHaveLength(1)
  })

  test("never lets a wait for another read's lock run past what is left", async () => {
    await ensurePrivateDir(h.stateDir)
    await ensurePrivateDir(fxPaths(h.stateDir).dir)
    const release = tryReadLock(fxPaths(h.stateDir).lock)!
    try {
      const reader = h.reader(undefined, { budgetMs: 2000 })
      expect(await rejected(reader.fxtwitter().get("/2/status/1"))).toMatchObject({
        code: "rate_limited",
        details: { source: "fxtwitter", reason: "read_lock" },
      })
      expect(h.sleeps.reduce((total, ms) => total + ms, 0)).toBe(2000)
    } finally {
      release()
    }
  })

  test("limits the wait for the reading account's lock to 90 s, or to what is left", async () => {
    await h.reader().account("check", {})
    await h.reader(undefined, { budgetMs: 5000 }).account("check", {})
    expect(h.accountReads.map((read) => read.lockWaitMs)).toEqual([DEFAULT_LOCK_WAIT_MS, 5000])
  })
})

describe("createReader: FxTwitter", () => {
  test("makes one client for the call, which sends the runtime's User-Agent", async () => {
    h.fake.route("/2/status/1", { status: 200, body: {} })
    const reader = h.reader()
    expect(reader.fxtwitter()).toBe(reader.fxtwitter())
    await reader.fxtwitter().get("/2/status/1")
    expect(h.fake.requests[0]!.headers["user-agent"]).toBe(USER_AGENT)
    expect(reader.fxtwitter().failures()).toBe(0)
  })

  test("is paced by the settings in force", async () => {
    h.fake.route("/2/status/1", { status: 200, body: {} })
    const reader = h.reader({ fxtwitter_gap_ms: 2000 })
    await reader.fxtwitter().get("/2/status/1")
    await reader.fxtwitter().get("/2/status/1")
    expect(h.sleeps).toEqual([2000])
  })

  test("is never reached under account_only: asking for the client is a bug", () => {
    const reader = h.reader({ account_only: true })
    expect(reader.accountOnly).toBe(true)
    expect(thrown(() => reader.fxtwitter())).toMatchObject({ code: "internal_error" })
    expect(h.fake.requests).toEqual([])
    expect(h.reader({ account_only: false }).accountOnly).toBe(false)
    expect(h.reader().accountOnly).toBe(false)
  })
})

describe("createReader: the reading account", () => {
  test("hasAccount tells whether a label exists, and keeps its first answer", async () => {
    const reader = h.reader()
    expect(await reader.hasAccount()).toBe(false)
    await h.label()
    expect(await reader.hasAccount()).toBe(false)
    expect(await h.reader().hasAccount()).toBe(true)
  })

  test("reads through the bridge under the install directory, as the label asked", async () => {
    const controller = new AbortController()
    const reader = createReader(
      { ...h.context({ reads_per_day: 3 }), signal: controller.signal },
      {
        readAccount: async (options) => {
          h.accountReads.push(options)
          return ACCOUNT_ANSWER
        },
      },
    )
    expect(await reader.account("post", { id: "1" }, "work")).toEqual(ACCOUNT_ANSWER)
    expect(h.accountReads).toHaveLength(1)
    expect(h.accountReads[0]).toMatchObject({
      stateDir: h.stateDir,
      account: "work",
      envPrefix: "TEST",
      env: {},
      bridgeFile: BRIDGE_FILE,
      op: "post",
      args: { id: "1" },
      options: { reads_per_day: 3 },
      signal: controller.signal,
    })
    expect(BRIDGE_FILE).toBe(`${OWN_DIR}/engine/bridge.py`)
  })

  test("leaves the label out when none is given", async () => {
    await h.reader().account("post", {})
    expect(h.accountReads[0]!.account).toBeUndefined()
  })
})

describe("createReader: what a call must have", () => {
  test("needs the runtime and an absolute state directory", () => {
    const ctx = h.context()
    for (const broken of [
      { ...ctx, runtime: undefined },
      { ...ctx, stateDir: undefined },
      { ...ctx, stateDir: "relative" },
      { cwd: "/" },
    ]) {
      expect(thrown(() => createReader(broken))).toMatchObject({ code: "internal_error" })
    }
  })

  test("needs an absolute install directory for a read of the reading account only", async () => {
    const ctx = h.context()
    for (const ownDir of [undefined, "relative"]) {
      const reader = createReader({ ...ctx, ownDir }, { readAccount: async () => ACCOUNT_ANSWER })
      expect(await rejected(reader.account("post", {}))).toMatchObject({ code: "internal_error" })
    }
  })
})
