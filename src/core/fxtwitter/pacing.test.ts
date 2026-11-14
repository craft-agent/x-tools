import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "../errors"
import { DAY_MS } from "../x/pacing"
import { T0, iso } from "./fxtwitter.testing"
import {
  DEFAULT_FX_PACE,
  cooldownAfter429,
  fxPaceSettings,
  fxPaceWait,
  fxPaths,
  readFxPacingState,
  writeFxPacingState,
  type FxPacingState,
} from "./pacing"

describe("fxPaceSettings", () => {
  test("takes the defaults when nothing is set", () => {
    expect(fxPaceSettings()).toEqual({ gapMs: 500, perDay: 1000, cooldownSeconds: 900 })
    expect(DEFAULT_FX_PACE).toEqual({ gapMs: 500, perDay: 1000, cooldownSeconds: 900 })
  })

  test("reads the three options", () => {
    expect(
      fxPaceSettings({ fxtwitter_gap_ms: 800, fxtwitter_reads_per_day: 50, fxtwitter_cooldown_seconds: 120 }),
    ).toEqual({
      gapMs: 800,
      perDay: 50,
      cooldownSeconds: 120,
    })
  })

  test("a value that is not a number takes its default", () => {
    expect(
      fxPaceSettings({ fxtwitter_gap_ms: "800", fxtwitter_reads_per_day: true, fxtwitter_cooldown_seconds: ["1"] }),
    ).toEqual(DEFAULT_FX_PACE)
  })
})

describe("FxTwitter's state", () => {
  let stateDir: string
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "xfxstate-"))
  })
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }))

  test("the paths sit under <state>/fxtwitter", () => {
    expect(fxPaths(stateDir)).toEqual({
      dir: join(stateDir, "fxtwitter"),
      lock: join(stateDir, "fxtwitter", "read.lock"),
      pacing: join(stateDir, "fxtwitter", "pacing.json"),
    })
  })

  test("a relative state directory is an internal_error", () => {
    expect(() => fxPaths("state")).toThrow(/absolute/)
  })

  test("a missing, empty or malformed file is the empty state", async () => {
    const paths = fxPaths(stateDir)
    const empty = { calls: [], cooldown_until: null }
    expect(await readFxPacingState(paths)).toEqual(empty)
    mkdirSync(paths.dir)
    for (const text of ["", "not json", '["calls"]', '{"calls":"x"}', '{"calls":[1,"2"]}', '{"cooldown_until":5}']) {
      writeFileSync(paths.pacing, text)
      expect(await readFxPacingState(paths)).toEqual(empty)
    }
  })

  test("a state with only one field keeps it and defaults the other", async () => {
    const paths = fxPaths(stateDir)
    mkdirSync(paths.dir)
    writeFileSync(paths.pacing, JSON.stringify({ calls: [1, 2] }))
    expect(await readFxPacingState(paths)).toEqual({ calls: [1, 2], cooldown_until: null })
  })

  test("writes a private file with the last 24 hours of calls and the cooldown only", async () => {
    const paths = fxPaths(stateDir)
    mkdirSync(paths.dir)
    const state: FxPacingState = { calls: [T0 - DAY_MS, T0 - DAY_MS + 1, T0], cooldown_until: iso(T0 + 1000) }
    await writeFxPacingState(paths, state, T0)
    expect(JSON.parse(await readFile(paths.pacing, "utf8"))).toEqual({
      calls: [T0 - DAY_MS + 1, T0],
      cooldown_until: iso(T0 + 1000),
    })
    expect(statSync(paths.pacing).mode & 0o777).toBe(0o600)
  })
})

describe("fxPaceWait", () => {
  const settings = { gapMs: 500, perDay: 3, cooldownSeconds: 900 }
  const state = (extra: Partial<FxPacingState>): FxPacingState => ({ calls: [], cooldown_until: null, ...extra })

  function refusal(run: () => unknown) {
    try {
      run()
    } catch (error) {
      if (isToolError(error)) return error
      throw error
    }
    throw new Error("expected a refusal")
  }

  test("no request yet means no wait", () => {
    expect(fxPaceWait(state({}), settings, T0)).toBe(0)
  })

  test("waits what is left of the gap since the last request", () => {
    expect(fxPaceWait(state({ calls: [T0 - 100_000, T0 - 200] }), settings, T0)).toBe(300)
    expect(fxPaceWait(state({ calls: [T0 - 500] }), settings, T0)).toBe(0)
    expect(fxPaceWait(state({ calls: [T0 - 9_000] }), settings, T0)).toBe(0)
  })

  test("a request dated in the future never holds a call longer than one gap", () => {
    expect(fxPaceWait(state({ calls: [T0 + 3_600_000] }), settings, T0)).toBe(500)
  })

  test("refuses at the daily cap, saying when the oldest request leaves the window", () => {
    const oldest = T0 - DAY_MS + 60_000
    const error = refusal(() =>
      fxPaceWait(state({ calls: [T0 - 10_000, oldest, T0 - 5_000, T0 - DAY_MS] }), settings, T0),
    )
    expect(error.code).toBe("rate_limited")
    expect(error.details).toEqual({
      source: "fxtwitter",
      reason: "fxtwitter_daily_cap",
      retry_at: iso(oldest + DAY_MS),
    })
  })

  test("a request exactly 24 hours old is out of the window", () => {
    expect(fxPaceWait(state({ calls: [T0 - DAY_MS, T0 - 10_000_000, T0 - 20_000_000] }), settings, T0)).toBe(0)
  })

  test("refuses while a cooldown runs", () => {
    const end = iso(T0 + 60_000)
    const error = refusal(() => fxPaceWait(state({ cooldown_until: end }), settings, T0))
    expect(error.code).toBe("rate_limited")
    expect(error.message).toBe(`FxTwitter asked the package to slow down; it is read again from ${end}.`)
    expect(error.details).toEqual({ source: "fxtwitter", reason: "fxtwitter_cooldown", retry_at: end })
  })

  test("a cooldown that has passed, or cannot be read, refuses nothing", () => {
    expect(fxPaceWait(state({ cooldown_until: iso(T0) }), settings, T0)).toBe(0)
    expect(fxPaceWait(state({ cooldown_until: iso(T0 - 1) }), settings, T0)).toBe(0)
    expect(fxPaceWait(state({ cooldown_until: "garbage" }), settings, T0)).toBe(0)
  })
})

describe("cooldownAfter429", () => {
  const settings = { gapMs: 500, perDay: 1000, cooldownSeconds: 900 }
  const after = (retryAfter: string | null) => cooldownAfter429(retryAfter, settings, T0)

  test("Retry-After in seconds", () => {
    expect(after("120")).toBe(iso(T0 + 120_000))
    expect(after(" 30 ")).toBe(iso(T0 + 30_000))
  })

  test("Retry-After as an HTTP date", () => {
    expect(after(new Date(T0 + 300_000).toUTCString())).toBe(iso(T0 + 300_000))
  })

  test("clamps to 1 second and 6 hours", () => {
    expect(after("0")).toBe(iso(T0 + 1000))
    expect(after(new Date(T0 - 60_000).toUTCString())).toBe(iso(T0 + 1000))
    expect(after("99999999")).toBe(iso(T0 + 6 * 3_600_000))
    expect(after("9".repeat(400))).toBe(iso(T0 + 6 * 3_600_000))
    expect(after(new Date(T0 + 30 * 86_400_000).toUTCString())).toBe(iso(T0 + 6 * 3_600_000))
  })

  test("a missing or unreadable Retry-After takes the setting", () => {
    for (const value of [null, "", "soon", "-5", "1.5", "12abc"]) {
      expect(after(value)).toBe(iso(T0 + 900_000))
    }
  })
})
