import { ToolError, isAbortError } from "../errors"
import { ensurePrivateDir } from "../x/private-dir"
import { stateRoot } from "../x/labels"
import { waitForReadLock } from "../x/read-lock"
import { abortableSleep } from "../x/sleep"
import {
  callsInLastDay,
  cooldownAfter429,
  fxCooldownError,
  fxPaceWait,
  fxPaths,
  readFxPacingState,
  writeFxPacingState,
  type FxPaceSettings,
} from "./pacing"
import { checkFxPath, fxGet, type Connect, type FxResponse } from "./transport"

/** How many failures in a row end FxTwitter's part of a call. */
export const MAX_FAILURES_IN_A_ROW = 3

/** How long a request waits for another one to finish: a little over one request's time limit, as for the reading account. */
const DEFAULT_LOCK_WAIT_MS = 90_000

const LOCK_HELD_MESSAGE = "Another read of FxTwitter is still running; try again shortly."

/** What `createFxClient` needs. */
export type FxClientOptions = {
  stateDir: string
  /** Sent as `User-Agent`. */
  userAgent: string
  settings: FxPaceSettings
  signal?: AbortSignal
  /** The clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** Waits `ms`, rejecting with an `AbortError` when `signal` aborts; defaults to a timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Sends the request elsewhere, for tests; defaults to `https.request`. */
  connect?: Connect
  /** How long to wait for another request to finish; defaults to 90 s. */
  lockWaitMs?: number
  /** For tests only: the time limit of one request. */
  timeoutMs?: number
}

/** What a tool call reads FxTwitter through. */
export type FxClient = {
  /** One paced `GET` of `path`; any reply but a 429 or a 5xx comes back as it is, a 404 and a 401 included. */
  get(path: string): Promise<FxResponse>
  /** The failures in a row this client has seen; a success resets it. */
  failures(): number
}

function failingError(): ToolError {
  return new ToolError("upstream_error", "FxTwitter failed three times in a row; it is not asked again in this call.", {
    details: { source: "fxtwitter", reason: "fxtwitter_failing" },
  })
}

/**
 * The client of one tool call: every request goes through FxTwitter's own
 * pacing, the way every read of X goes through the reading account's.
 *
 * Under a lock shared by every process of the state directory it reads the
 * state, refuses while a cooldown runs or past the daily cap (`rate_limited`,
 * without contacting FxTwitter), waits out the gap (an abort there counts
 * nothing) and records the request before sending it, so it counts whether or
 * not it succeeds. A 429 starts a cooldown from its `Retry-After` and throws
 * `rate_limited`; a 5xx throws `upstream_error`. Those, and any failure of
 * the request itself, count as failures; after `MAX_FAILURES_IN_A_ROW` the
 * client refuses without a request. An abort counts as neither a failure nor
 * a success, and any other reply is a success. The state holds times only.
 */
export function createFxClient(options: FxClientOptions): FxClient {
  const { stateDir, userAgent, settings, signal, connect, timeoutMs } = options
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  const paths = fxPaths(stateDir)
  let failures = 0

  async function requestUnderLock(path: string): Promise<FxResponse> {
    const start = now()
    const stored = await readFxPacingState(paths)
    const state = { ...stored, calls: callsInLastDay(stored.calls, start) }

    const wait = fxPaceWait(state, settings, start)
    if (wait > 0) {
      await sleep(wait, signal)
      signal?.throwIfAborted()
    }

    const sentAt = now()
    const nextCalls = [...state.calls, sentAt]
    await writeFxPacingState(paths, { ...state, calls: nextCalls }, sentAt)

    let response: FxResponse
    try {
      response = await fxGet(path, { userAgent, signal, connect, timeoutMs })
    } catch (error) {
      if (!isAbortError(error)) failures += 1
      throw error
    }

    if (response.status === 429) {
      failures += 1
      const retryAt = cooldownAfter429(response.retryAfter, settings, now())
      // The 429 is the failure to report; a state that cannot be kept is not.
      await writeFxPacingState(paths, { calls: nextCalls, cooldown_until: retryAt }, now()).catch(() => {})
      throw fxCooldownError("fxtwitter_429", retryAt)
    }
    if (response.status >= 500 && response.status < 600) {
      failures += 1
      throw new ToolError("upstream_error", `FxTwitter answered with an error (${response.status}).`, {
        details: { source: "fxtwitter", reason: "server_error", status: response.status },
      })
    }
    failures = 0
    return response
  }

  return {
    async get(path) {
      checkFxPath(path)
      if (failures >= MAX_FAILURES_IN_A_ROW) throw failingError()
      const { root } = stateRoot(stateDir)
      await ensurePrivateDir(root)
      await ensurePrivateDir(paths.dir)
      const release = await waitForReadLock(paths.lock, {
        waitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
        signal,
        heldMessage: LOCK_HELD_MESSAGE,
        heldDetails: { source: "fxtwitter" },
        now,
        sleep,
      })
      try {
        return await requestUnderLock(path)
      } finally {
        release()
      }
    },
    failures: () => failures,
  }
}
