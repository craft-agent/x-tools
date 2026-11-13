import { describe, expect, test } from "bun:test"
import { DAY_MS, DEFAULT_PACE, HOUR_MS, paceSettings, paceWait, readsUsed, type PacingState } from "./pacing"

const NOW = Date.parse("2026-01-01T12:00:00.000Z")
const MINUTE = 60_000
const GAP_MS = DEFAULT_PACE.gapSeconds * 1000

function state(calls: number[], rest: Partial<PacingState> = {}): PacingState {
  return { calls, refused: null, rate_limited_until: null, ...rest }
}

function failure(run: () => unknown) {
  try {
    run()
  } catch (error) {
    return error as Error & { code?: string; details?: Record<string, unknown> }
  }
  throw new Error("expected a failure")
}

describe("paceSettings", () => {
  test("is the defaults without options", () => {
    expect(DEFAULT_PACE).toEqual({ gapSeconds: 5, perHour: 30, perDay: 200 })
    expect(paceSettings()).toEqual(DEFAULT_PACE)
    expect(paceSettings({})).toEqual(DEFAULT_PACE)
  })

  test("takes the three settings when they are numbers", () => {
    expect(paceSettings({ read_gap_seconds: 9, reads_per_hour: 10, reads_per_day: 50 })).toEqual({
      gapSeconds: 9,
      perHour: 10,
      perDay: 50,
    })
  })

  test("takes a default for a setting that is not a number", () => {
    expect(
      paceSettings({ read_gap_seconds: "9", reads_per_hour: true, reads_per_day: ["1"], state_dir: "/s" }),
    ).toEqual(DEFAULT_PACE)
  })
})

describe("readsUsed", () => {
  test("counts the last hour and the last 24 hours", () => {
    expect(readsUsed(state([]), NOW)).toEqual({ last_hour: 0, last_day: 0 })
    expect(readsUsed(state([NOW, NOW - 1, NOW - 2 * HOUR_MS]), NOW)).toEqual({ last_hour: 2, last_day: 3 })
  })

  test("a read exactly an hour old is out of the hour but in the day", () => {
    expect(readsUsed(state([NOW - HOUR_MS]), NOW)).toEqual({ last_hour: 0, last_day: 1 })
    expect(readsUsed(state([NOW - HOUR_MS + 1]), NOW)).toEqual({ last_hour: 1, last_day: 1 })
  })

  test("a read exactly 24 hours old is out of both", () => {
    expect(readsUsed(state([NOW - DAY_MS]), NOW)).toEqual({ last_hour: 0, last_day: 0 })
    expect(readsUsed(state([NOW - DAY_MS + 1]), NOW)).toEqual({ last_hour: 0, last_day: 1 })
  })
})

describe("paceWait: the gap", () => {
  test.each([
    ["no read yet", [], 0],
    ["the last read just now", [NOW], GAP_MS],
    ["part of the gap passed", [NOW - 2000], GAP_MS - 2000],
    ["one millisecond short of the gap", [NOW - GAP_MS + 1], 1],
    ["the gap just passed", [NOW - GAP_MS], 0],
    ["long since", [NOW - 30 * MINUTE], 0],
  ] as const)("%s", (_name, calls, expected) => {
    expect(paceWait(state([...calls]), DEFAULT_PACE, NOW)).toBe(expected)
  })

  test("follows the latest read, whatever the order, and the setting", () => {
    expect(paceWait(state([NOW - 1000, NOW - 4000]), DEFAULT_PACE, NOW)).toBe(GAP_MS - 1000)
    expect(paceWait(state([NOW]), { ...DEFAULT_PACE, gapSeconds: 60 }, NOW)).toBe(60_000)
  })
})

describe("paceWait: the hourly cap", () => {
  const settings = { gapSeconds: 5, perHour: 3, perDay: 200 }
  const inHour = (count: number) => Array.from({ length: count }, (_, index) => NOW - 10 * MINUTE - index * MINUTE)

  test("one under the cap goes on", () => {
    expect(paceWait(state(inHour(2)), settings, NOW)).toBe(0)
  })

  test("exactly at the cap refuses with the time the oldest read leaves the hour", () => {
    const calls = inHour(3)
    const error = failure(() => paceWait(state(calls), settings, NOW))
    const retryAt = new Date(Math.min(...calls) + HOUR_MS).toISOString()
    expect(error.code).toBe("rate_limited")
    expect(error.message).toBe(`This reading account has used its 3 reads for this hour; try again at ${retryAt}.`)
    expect(error.details).toEqual({ reason: "hourly_cap", retry_at: retryAt })
  })

  test("a read exactly an hour old no longer counts", () => {
    expect(paceWait(state([NOW - HOUR_MS, NOW - 20 * MINUTE, NOW - 10 * MINUTE]), settings, NOW)).toBe(0)
    const error = failure(() =>
      paceWait(state([NOW - HOUR_MS + 1, NOW - 20 * MINUTE, NOW - 10 * MINUTE]), settings, NOW),
    )
    expect(error.details).toEqual({ reason: "hourly_cap", retry_at: new Date(NOW + 1).toISOString() })
  })
})

describe("paceWait: the daily cap", () => {
  const settings = { gapSeconds: 5, perHour: 30, perDay: 3 }
  const inDay = (count: number) => Array.from({ length: count }, (_, index) => NOW - 2 * HOUR_MS - index * HOUR_MS)

  test("one under the cap goes on", () => {
    expect(paceWait(state(inDay(2)), settings, NOW)).toBe(0)
  })

  test("exactly at the cap refuses with the time the oldest read leaves the day", () => {
    const calls = inDay(3)
    const error = failure(() => paceWait(state(calls), settings, NOW))
    const retryAt = new Date(Math.min(...calls) + DAY_MS).toISOString()
    expect(error.code).toBe("rate_limited")
    expect(error.message).toBe(
      `This reading account has used its 3 reads for the last 24 hours; try again at ${retryAt}.`,
    )
    expect(error.details).toEqual({ reason: "daily_cap", retry_at: retryAt })
  })

  test("a read exactly 24 hours old no longer counts", () => {
    expect(paceWait(state([NOW - DAY_MS, NOW - 2 * HOUR_MS, NOW - 3 * HOUR_MS]), settings, NOW)).toBe(0)
  })
})

describe("paceWait: X's rate limit", () => {
  const until = new Date(NOW + 10 * MINUTE).toISOString()

  test("a limit after now refuses with its end", () => {
    const error = failure(() => paceWait(state([], { rate_limited_until: until }), DEFAULT_PACE, NOW))
    expect(error.code).toBe("rate_limited")
    expect(error.message).toBe(`X is rate-limiting this reading account until ${until}; try again then.`)
    expect(error.details).toEqual({ reason: "x_rate_limit", retry_at: until })
  })

  test("a limit that ends now, ended earlier or cannot be read is no limit", () => {
    for (const value of [new Date(NOW).toISOString(), new Date(NOW - MINUTE).toISOString(), "not a time"]) {
      expect(paceWait(state([], { rate_limited_until: value }), DEFAULT_PACE, NOW)).toBe(0)
    }
  })

  test("comes before the caps", () => {
    const settings = { gapSeconds: 5, perHour: 1, perDay: 1 }
    const error = failure(() => paceWait(state([NOW - MINUTE], { rate_limited_until: until }), settings, NOW))
    expect(error.details?.reason).toBe("x_rate_limit")
  })

  test("the hourly cap comes before the daily one", () => {
    const settings = { gapSeconds: 5, perHour: 1, perDay: 1 }
    expect(failure(() => paceWait(state([NOW - MINUTE]), settings, NOW)).details?.reason).toBe("hourly_cap")
    expect(failure(() => paceWait(state([NOW - 2 * HOUR_MS]), settings, NOW)).details?.reason).toBe("daily_cap")
  })
})
