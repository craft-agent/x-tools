import { ToolError, isToolError } from "../errors"
import type { EngineReply, EngineSession } from "./engine-call"
import type { LabelPaths } from "./labels"
import {
  DAY_MS,
  paceWait,
  readPacingState,
  writePacingState,
  type PaceSettings,
  type PacingState,
  type Refusal,
} from "./pacing"
import { waitForReadLock } from "./read-lock"
import { abortableSleep } from "./sleep"

/** What `pacedCall` needs. */
export type PacedCallOptions = {
  paths: LabelPaths
  settings: PaceSettings
  /** The fingerprint of the cookies this call will send. */
  fingerprint: string
  /** The engine call; it gets the fingerprint of the session X refused earlier, or null. */
  call: (refused: string | null) => Promise<EngineReply>
  signal?: AbortSignal
  /** The clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** Waits `ms`, rejecting with an `AbortError` when `signal` aborts; defaults to a timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** How long to wait for another read of the label to finish; defaults to 90 s. */
  lockWaitMs?: number
}

/** How long a read waits for the label's lock: a little over one read's time limit. */
const DEFAULT_LOCK_WAIT_MS = 90_000

/** Whether `error` says no request could have reached X: a program that cannot run, or a failure that names `contacted: false`. */
function neverContacted(error: unknown): boolean {
  if (!isToolError(error)) return false
  return error.code === "not_found" || error.code === "forbidden" || error.details?.contacted === false
}

/** The latest of the session's locks that still lies after `now`, as ISO 8601, or null. */
function latestFutureLock(session: EngineSession, now: number): string | null {
  const times = Object.values(session.locks)
    .map((lock) => Date.parse(lock))
    .filter((time) => time > now)
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
}

/** What the label remembers after a call: the call when it counted, and what X made of the session. */
function remember(
  state: PacingState,
  reply: EngineReply | undefined,
  counted: boolean,
  fingerprint: string,
  now: number,
): PacingState {
  const calls = counted ? [...state.calls, now] : state.calls
  if (!reply?.session) return { ...state, calls }
  const { session } = reply
  const refused: Refusal | null = session.active
    ? null
    : { fingerprint: reply.fingerprint ?? fingerprint, error: session.error, at: new Date(now).toISOString() }
  return { calls, refused, rate_limited_until: latestFutureLock(session, now) }
}

function refusedError(refusal: Refusal): ToolError {
  return new ToolError(
    "unauthenticated",
    "X refused this reading account's session; sign in again with fresh cookies.",
    {
      details: { reason: "refused", refused_at: refusal.at },
    },
  )
}

async function readUnderLock(
  options: PacedCallOptions,
  now: () => number,
  sleep: NonNullable<PacedCallOptions["sleep"]>,
): Promise<EngineReply> {
  const { paths, settings, fingerprint, call, signal } = options
  const start = now()
  const stored = await readPacingState(paths)
  const state = { ...stored, calls: stored.calls.filter((time) => start - time < DAY_MS) }

  if (state.refused?.fingerprint === fingerprint) throw refusedError(state.refused)
  const wait = paceWait(state, settings, start)
  if (wait > 0) {
    await sleep(wait, signal)
    signal?.throwIfAborted()
  }

  let reply: EngineReply
  try {
    reply = await call(state.refused?.fingerprint ?? null)
  } catch (error) {
    // The original failure is the one to report; a state that cannot be kept is not.
    await writePacingState(paths, remember(state, undefined, !neverContacted(error), fingerprint, now())).catch(
      () => {},
    )
    throw error
  }
  await writePacingState(paths, remember(state, reply, reply.contacted, fingerprint, now()))
  return reply
}

/**
 * Runs one engine call under the label's pacing, the way every read of X
 * goes: under the label's read lock (released however the call ends), it
 * refuses, without calling, while the label remembers a refusal of these same
 * cookies, while X's rate limit runs and past a cap; else it waits out the gap
 * (an abort there counts nothing) and calls.
 *
 * The call counts when the reply says it contacted X, and when it threw
 * anything but an error that says no request could have been made (`not_found`
 * or `forbidden` for a missing or unrunnable engine, or `details.contacted:
 * false`): a timeout, an abort after the start and a child that died without a
 * reply may have reached X. A reply's session is remembered even when the call
 * then fails: a refusal by its fingerprint, until the cookies change, and the
 * latest lock still ahead as X's rate limit. The state is a private file; the
 * reply is returned for the caller to map with `engineOutcome`.
 */
export async function pacedCall(options: PacedCallOptions): Promise<EngineReply> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  const release = await waitForReadLock(options.paths.lock, {
    waitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
    signal: options.signal,
    now,
    sleep,
  })
  try {
    return await readUnderLock(options, now, sleep)
  } finally {
    release()
  }
}
