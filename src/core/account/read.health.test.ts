import { afterEach, describe, expect, test } from "bun:test"
import type { ToolOptions } from "../tool"
import { AUTH, COOKIES, CT0 } from "../x/cookies.testing"
import { cookieFingerprint } from "../x/cookies"
import { removeTempDirs } from "../x/engine.testing"
import { DAY_MS, HOUR_MS, type PacingState } from "../x/pacing"
import { MINUTE_MS, NOW, fixture, readyFixture } from "./read.testing"

afterEach(removeTempDirs)

const FINGERPRINT = cookieFingerprint(COOKIES)
const iso = (time: number) => new Date(time).toISOString()

/** The one account's row of a ready engine whose pacing file holds `pacing`. */
async function rowWith(pacing: Partial<PacingState>, options?: ToolOptions) {
  const h = await readyFixture(options)
  await h.label("default", { pacing })
  return { h, row: (await h.read()).accounts[0]! }
}

describe("a refusal", () => {
  test("of the current cookies is shown with when and X's words, and asks for a login", async () => {
    const { row } = await rowWith({
      refused: { fingerprint: FINGERPRINT, error: "Could not authenticate you", at: iso(NOW - HOUR_MS) },
    })
    expect(row).toMatchObject({
      refused_at: iso(NOW - HOUR_MS),
      refused_error: "Could not authenticate you",
      health: "attention",
      reasons: ["refused"],
      action: "login",
    })
    expect(row.recovery_command).toContain("login --account 'default' --state-dir")
  })

  test("of other cookies is not shown, and the account stays ready", async () => {
    const { row } = await rowWith({
      refused: { fingerprint: "fedcba9876543210", error: "old", at: iso(NOW - HOUR_MS) },
    })
    expect(row).toMatchObject({ refused_at: null, refused_error: null, health: "ready", reasons: [], action: null })
  })

  test("with no words has no error, and X's words are clipped to 200 characters", async () => {
    const quiet = await rowWith({ refused: { fingerprint: FINGERPRINT, error: null, at: iso(NOW) } })
    expect(quiet.row).toMatchObject({ refused_at: iso(NOW), refused_error: null, reasons: ["refused"] })
    const long = await rowWith({ refused: { fingerprint: FINGERPRINT, error: "é".repeat(300), at: iso(NOW) } })
    expect(Array.from(long.row.refused_error!)).toHaveLength(200)
    expect(long.row.refused_error!.endsWith("…")).toBe(true)
  })

  test("never carries a cookie value in X's words", async () => {
    const error = `bad ${AUTH} and ${CT0} and ${COOKIES}`
    const { row } = await rowWith({ refused: { fingerprint: FINGERPRINT, error, at: iso(NOW) } })
    expect(row.refused_error).toBe("bad [masked] and [masked] and [masked]")
  })

  test("of cookies that cannot be used is not shown, since the session is another one", async () => {
    const h = await fixture()
    await h.engine()
    await h.label("default", { pacing: { refused: { fingerprint: FINGERPRINT, error: "x", at: iso(NOW) } } })
    expect((await h.read()).accounts[0]).toMatchObject({ refused_at: null, reasons: ["cookies_missing"] })
  })
})

describe("X's rate limit", () => {
  test("while it runs is shown, and the account waits until it ends", async () => {
    const { row } = await rowWith({ rate_limited_until: iso(NOW + 5 * MINUTE_MS) })
    expect(row).toMatchObject({
      rate_limited_until: iso(NOW + 5 * MINUTE_MS),
      health: "attention",
      reasons: ["rate_limited"],
      action: "wait",
      recovery_command: null,
    })
    expect(row.hint).toContain(iso(NOW + 5 * MINUTE_MS))
  })

  test("once over, or not a date, is not shown", async () => {
    for (const until of [iso(NOW - 1), iso(NOW), "not a date"]) {
      const { row } = await rowWith({ rate_limited_until: until })
      expect(row).toMatchObject({ rate_limited_until: null, health: "ready", action: null })
    }
  })
})

describe("the caps", () => {
  const calls = (...agesMinutes: number[]) => agesMinutes.map((age) => NOW - age * MINUTE_MS)

  test("the reads of the last hour and day are counted, a read exactly that old is out", async () => {
    const { row } = await rowWith({ calls: [NOW - HOUR_MS, NOW - HOUR_MS + 1, NOW - DAY_MS, NOW - 2 * HOUR_MS] })
    expect(row).toMatchObject({ reads_last_hour: 1, reads_last_day: 3, health: "ready" })
  })

  test("the hourly cap reached waits until the oldest read of the hour leaves it", async () => {
    const { row } = await rowWith({ calls: calls(10, 30, 20) }, { reads_per_hour: 3 })
    expect(row).toMatchObject({
      reads_last_hour: 3,
      reads_per_hour: 3,
      health: "attention",
      reasons: ["hourly_cap"],
      action: "wait",
    })
    expect(row.hint).toContain(iso(NOW - 30 * MINUTE_MS + HOUR_MS))
  })

  test("the daily cap reached waits until the oldest read of the day leaves it", async () => {
    const { row } = await rowWith({ calls: calls(2 * 60, 3 * 60) }, { reads_per_day: 2 })
    expect(row).toMatchObject({ reads_last_day: 2, reads_per_day: 2, reasons: ["daily_cap"], action: "wait" })
    expect(row.hint).toContain(iso(NOW - 3 * HOUR_MS + DAY_MS))
  })

  test("a rate limit and both caps wait until the last of them ends, and list every reason", async () => {
    const { row } = await rowWith(
      { calls: calls(10, 90), rate_limited_until: iso(NOW + MINUTE_MS) },
      { reads_per_hour: 1, reads_per_day: 2 },
    )
    expect(row.reasons).toEqual(["rate_limited", "hourly_cap", "daily_cap"])
    expect(row.action).toBe("wait")
    expect(row.hint).toContain(iso(NOW - 90 * MINUTE_MS + DAY_MS))
  })

  test("the settings of ctx.options are the ones reported, else the defaults", async () => {
    const defaults = await rowWith({})
    expect(defaults.row).toMatchObject({ reads_per_hour: 30, reads_per_day: 200 })
    const set = await rowWith({}, { reads_per_hour: 7, reads_per_day: 70, read_gap_seconds: 9 })
    expect(set.row).toMatchObject({ reads_per_hour: 7, reads_per_day: 70 })
    const odd = await rowWith({}, { reads_per_hour: "7" })
    expect(odd.row).toMatchObject({ reads_per_hour: 30 })
  })

  test("a lower cap changes what is reached with the same reads", async () => {
    const reads = { calls: calls(1, 2, 3) }
    expect((await rowWith(reads)).row.health).toBe("ready")
    expect((await rowWith(reads, { reads_per_hour: 3 })).row.reasons).toEqual(["hourly_cap"])
  })
})

describe("the next step", () => {
  test("a login outranks waiting", async () => {
    const h = await fixture()
    await h.engine()
    await h.label("default", { pacing: { rate_limited_until: iso(NOW + MINUTE_MS) } })
    expect((await h.read()).accounts[0]).toMatchObject({
      reasons: ["cookies_missing", "rate_limited"],
      action: "login",
    })
  })

  test("an engine that is missing comes first, and its command is the engine's", async () => {
    const h = await fixture()
    await h.label("default", { pacing: { rate_limited_until: iso(NOW + MINUTE_MS) } })
    const { engine, accounts } = await h.read()
    expect(accounts[0]).toMatchObject({
      reasons: ["engine_missing", "cookies_missing", "rate_limited"],
      action: "engine_install",
      health: "attention",
      recovery_command: engine.recovery_command,
    })
    expect(engine.recovery_command).toContain("engine install --state-dir")
  })

  test("an engine on other versions is a mismatch, reported with what is found", async () => {
    const h = await fixture()
    await h.engine({ pythonVersion: "3.11.9", twscrape: "0.1.0" })
    await h.label("default", { cookies: COOKIES })
    const { engine, accounts } = await h.read()
    expect(engine).toMatchObject({ status: "mismatch", python_version: "3.11.9", twscrape_version: "0.1.0" })
    expect(engine.recovery_command).not.toBeNull()
    expect(accounts[0]).toMatchObject({ reasons: ["engine_mismatch"], action: "engine_install" })
  })
})
