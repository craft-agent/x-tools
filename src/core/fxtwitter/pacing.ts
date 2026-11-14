import { join } from "node:path"
import { z } from "zod"
import { ToolError } from "../errors"
import type { ToolOptions } from "../tool"
import { stateRoot } from "../x/labels"
import { DAY_MS, HOUR_MS } from "../x/pacing"
import { readJsonFile, writePrivateFile } from "../x/private-file"

/** FxTwitter's gap between requests, its cap per 24 hours and the cooldown after a 429 without a `Retry-After`. */
export type FxPaceSettings = {
  gapMs: number
  perDay: number
  cooldownSeconds: number
}

/** The settings when none is given: a 500 ms gap, 1000 requests a day and a 15 minute cooldown. */
export const DEFAULT_FX_PACE: FxPaceSettings = { gapMs: 500, perDay: 1000, cooldownSeconds: 900 }

/** What FxTwitter's pacing remembers between calls: times, never a path or a reply. */
export type FxPacingState = {
  /** Epoch milliseconds of the requests sent. */
  calls: readonly number[]
  /** When the cooldown after a 429 ends (ISO 8601), or null. */
  cooldown_until: string | null
}

/** Where FxTwitter keeps its state; every path is inside `dir`. */
export type FxPaths = {
  /** `<root>/fxtwitter` */
  dir: string
  /** The read lock: one request to FxTwitter at a time, across processes. */
  lock: string
  /** The request times and the end of a cooldown. */
  pacing: string
}

/** The shortest and the longest cooldown a `Retry-After` can set. */
const MIN_COOLDOWN_MS = 1000
const MAX_COOLDOWN_MS = 6 * HOUR_MS

const EMPTY_STATE: FxPacingState = { calls: [], cooldown_until: null }

const stateSchema = z.object({
  calls: z.array(z.number()).default([]),
  cooldown_until: z.string().nullable().default(null),
})

/** The pacing settings among the tool options (`fxtwitter_gap_ms`, `fxtwitter_reads_per_day`, `fxtwitter_cooldown_seconds`); one that is not a number takes its default. */
export function fxPaceSettings(options?: ToolOptions): FxPaceSettings {
  const number = (name: string, fallback: number) => {
    const value = options?.[name]
    return typeof value === "number" ? value : fallback
  }
  return {
    gapMs: number("fxtwitter_gap_ms", DEFAULT_FX_PACE.gapMs),
    perDay: number("fxtwitter_reads_per_day", DEFAULT_FX_PACE.perDay),
    cooldownSeconds: number("fxtwitter_cooldown_seconds", DEFAULT_FX_PACE.cooldownSeconds),
  }
}

/** Resolves FxTwitter's paths under the state root `stateDir`; throws `internal_error` for a relative one. */
export function fxPaths(stateDir: string): FxPaths {
  const { fxtwitter: dir } = stateRoot(stateDir)
  return { dir, lock: join(dir, "read.lock"), pacing: join(dir, "pacing.json") }
}

/** What FxTwitter's pacing remembers; a missing, unreadable or malformed file is the empty state, never an error. */
export async function readFxPacingState(paths: FxPaths): Promise<FxPacingState> {
  const parsed = stateSchema.safeParse(await readJsonFile(paths.pacing))
  return parsed.success ? parsed.data : EMPTY_STATE
}

/** The request times in `calls` less than 24 hours old at `now`. */
export function callsInLastDay(calls: readonly number[], now: number): number[] {
  return calls.filter((time) => now - time < DAY_MS)
}

/** Writes the state as a private file, keeping only the requests of the 24 hours before `now`. */
export async function writeFxPacingState(paths: FxPaths, state: FxPacingState, now: number): Promise<void> {
  const calls = callsInLastDay(state.calls, now)
  await writePrivateFile(paths.pacing, `${JSON.stringify({ ...state, calls })}\n`)
}

/** The refusal while FxTwitter is left alone until `retryAt` (ISO 8601); `reason` says why. */
export function fxCooldownError(reason: string, retryAt: string): ToolError {
  return new ToolError("rate_limited", `FxTwitter asked the package to slow down; it is read again from ${retryAt}.`, {
    details: { source: "fxtwitter", reason, retry_at: retryAt },
  })
}

/**
 * Whether a request may be sent at `now`, without contacting FxTwitter.
 * Throws `rate_limited` while a cooldown runs (`fxtwitter_cooldown`) and once
 * the last 24 hours hold `perDay` requests (`fxtwitter_daily_cap`), each with
 * `details.retry_at`. Otherwise it gives the milliseconds to wait for the gap
 * since the last request, 0 when none.
 */
export function fxPaceWait(state: FxPacingState, settings: FxPaceSettings, now: number): number {
  const cooldownEnd = state.cooldown_until === null ? NaN : Date.parse(state.cooldown_until)
  if (cooldownEnd > now) throw fxCooldownError("fxtwitter_cooldown", new Date(cooldownEnd).toISOString())

  const lastDay = callsInLastDay(state.calls, now)
  if (lastDay.length >= settings.perDay) {
    const retryAt = new Date(Math.min(...lastDay) + DAY_MS).toISOString()
    throw new ToolError(
      "rate_limited",
      `FxTwitter has been asked ${settings.perDay} times in the last 24 hours; it is read again from ${retryAt}.`,
      { details: { source: "fxtwitter", reason: "fxtwitter_daily_cap", retry_at: retryAt } },
    )
  }

  if (lastDay.length === 0) return 0
  // A request dated after `now` (a clock set back) never holds the call longer than one gap.
  return Math.min(settings.gapMs, Math.max(0, Math.max(...lastDay) + settings.gapMs - now))
}

/** The cooldown a `Retry-After` asks for, in milliseconds: delta-seconds or an HTTP date; undefined when it is neither. */
function retryAfterMs(retryAfter: string | null, now: number): number | undefined {
  const text = retryAfter?.trim() ?? ""
  if (/^\d+$/.test(text)) return Number(text) * 1000
  // An HTTP date always names its day and month, which keeps a stray number from parsing as a year.
  if (/[a-z]/i.test(text)) {
    const date = Date.parse(text)
    if (!Number.isNaN(date)) return date - now
  }
  return undefined
}

/**
 * When the cooldown after a 429 ends (ISO 8601): the reply's `Retry-After`,
 * as delta-seconds or an HTTP date, clamped to 1 second … 6 hours; without
 * one, or with one that cannot be read, `settings.cooldownSeconds`.
 */
export function cooldownAfter429(retryAfter: string | null, settings: FxPaceSettings, now: number): string {
  const asked = retryAfterMs(retryAfter, now)
  const ms =
    asked === undefined ? settings.cooldownSeconds * 1000 : Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, asked))
  return new Date(now + ms).toISOString()
}
