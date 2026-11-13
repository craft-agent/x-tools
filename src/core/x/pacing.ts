import { z } from "zod"
import { ToolError } from "../errors"
import type { ToolOptions } from "../tool"
import type { LabelPaths } from "./labels"
import { readJsonFile, writePrivateFile } from "./private-file"

/** What X last refused: the fingerprint of the session, the reason it gave and when (ISO 8601). */
export type Refusal = { fingerprint: string; error: string | null; at: string }

/** What a label remembers between reads. */
export type PacingState = {
  /** Epoch milliseconds of the reads that counted. */
  calls: readonly number[]
  /** The session X refused, until its cookies change. */
  refused: Refusal | null
  /** When X's rate limit on the session ends (ISO 8601), or null. */
  rate_limited_until: string | null
}

/** The gap between reads and the caps on them. */
export type PaceSettings = {
  gapSeconds: number
  perHour: number
  perDay: number
}

/** The settings when none is given: a 5 s gap, 30 reads an hour and 200 a day. */
export const DEFAULT_PACE: PaceSettings = { gapSeconds: 5, perHour: 30, perDay: 200 }

/** One hour, in milliseconds. */
export const HOUR_MS = 3_600_000

/** One day, in milliseconds. */
export const DAY_MS = 24 * HOUR_MS

const EMPTY_STATE: PacingState = { calls: [], refused: null, rate_limited_until: null }

const stateSchema = z.object({
  calls: z.array(z.number()).default([]),
  refused: z.object({ fingerprint: z.string(), error: z.string().nullable(), at: z.string() }).nullable().default(null),
  rate_limited_until: z.string().nullable().default(null),
})

/** The pacing settings among the tool options (`read_gap_seconds`, `reads_per_hour`, `reads_per_day`); one that is not a number takes its default. */
export function paceSettings(options?: ToolOptions): PaceSettings {
  const number = (name: string, fallback: number) => {
    const value = options?.[name]
    return typeof value === "number" ? value : fallback
  }
  return {
    gapSeconds: number("read_gap_seconds", DEFAULT_PACE.gapSeconds),
    perHour: number("reads_per_hour", DEFAULT_PACE.perHour),
    perDay: number("reads_per_day", DEFAULT_PACE.perDay),
  }
}

/** What the label remembers; a missing, unreadable or malformed file is the empty state, never an error. */
export async function readPacingState(paths: LabelPaths): Promise<PacingState> {
  const parsed = stateSchema.safeParse(await readJsonFile(paths.pacing))
  return parsed.success ? parsed.data : EMPTY_STATE
}

/** Writes the state as a private file; the caller prunes `calls` to the last 24 hours first. */
export async function writePacingState(paths: LabelPaths, state: PacingState): Promise<void> {
  await writePrivateFile(paths.pacing, `${JSON.stringify(state)}\n`)
}

/** The reads of `state` less than `windowMs` old at `now`. */
function within(state: PacingState, now: number, windowMs: number): number[] {
  return state.calls.filter((time) => now - time < windowMs)
}

/** How many counted reads fall in the last hour and in the last 24 hours at `now`; a read exactly that old is out. */
export function readsUsed(state: PacingState, now: number): { last_hour: number; last_day: number } {
  return { last_hour: within(state, now, HOUR_MS).length, last_day: within(state, now, DAY_MS).length }
}

function capReached(
  reads: number[],
  cap: number,
  windowMs: number,
  period: string,
  reason: string,
): ToolError | undefined {
  if (reads.length < cap) return undefined
  const retryAt = new Date(Math.min(...reads) + windowMs).toISOString()
  return new ToolError(
    "rate_limited",
    `This reading account has used its ${cap} reads for ${period}; try again at ${retryAt}.`,
    {
      details: { reason, retry_at: retryAt },
    },
  )
}

/**
 * Whether a read may start at `now`, without contacting X. Throws
 * `rate_limited` while X's rate limit on the session runs (`x_rate_limit`),
 * and once the hour or the 24 hours hold `perHour` or `perDay` reads
 * (`hourly_cap`, `daily_cap`), each with `details.retry_at`. Otherwise it
 * gives the milliseconds to wait for the gap since the last read, 0 when none.
 */
export function paceWait(state: PacingState, settings: PaceSettings, now: number): number {
  const limitedUntil = state.rate_limited_until === null ? NaN : Date.parse(state.rate_limited_until)
  if (limitedUntil > now) {
    const retryAt = new Date(limitedUntil).toISOString()
    throw new ToolError("rate_limited", `X is rate-limiting this reading account until ${retryAt}; try again then.`, {
      details: { reason: "x_rate_limit", retry_at: retryAt },
    })
  }

  const hour = capReached(within(state, now, HOUR_MS), settings.perHour, HOUR_MS, "this hour", "hourly_cap")
  if (hour) throw hour
  const day = capReached(within(state, now, DAY_MS), settings.perDay, DAY_MS, "the last 24 hours", "daily_cap")
  if (day) throw day

  if (state.calls.length === 0) return 0
  return Math.max(0, Math.max(...state.calls) + settings.gapSeconds * 1000 - now)
}
