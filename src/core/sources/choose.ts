import { ToolError, isToolError } from "../errors"
import type { FxClient } from "../fxtwitter/client"
import type { Reader } from "./reader"
import type { Answerer, Source } from "./source"

/** Why FxTwitter's own answer may be bettered by the reading account. */
type FallbackReason = "protected" | "logged_out"

/** What a read of FxTwitter came to. */
export type FxOutcome<T> =
  /** Final: an answer, or a final "not found". */
  | { kind: "answer"; value: T }
  /** FxTwitter's own answer, which the reading account may better. */
  | { kind: "fallback"; reason: FallbackReason; value: T }

/** A read as the two sources do it. */
export type SourcedRead<T> = {
  /** Absent when FxTwitter does not offer the read. */
  fxtwitter?: (client: FxClient) => Promise<FxOutcome<T>>
  account: (reader: Reader) => Promise<T>
}

/** What a read gave and the source that gave it. */
export type Sourced<T> = { source: Answerer; value: T }

const NOT_OFFERED_MESSAGE = "FxTwitter does not offer this read; use source auto or account."

const ACCOUNT_ONLY_MESSAGE =
  "FxTwitter is turned off by the account_only setting; use source auto or account, or turn the setting off."

/** Whether `error` says FxTwitter itself is down or limiting the package, which the reading account may answer instead. */
function isFxTwitterFailure(error: unknown): error is ToolError {
  return isToolError(error) && error.details?.source === "fxtwitter"
}

/**
 * Runs `read` on the source the call chose.
 *
 * - `fxtwitter` reads only FxTwitter: `invalid_argument` under `account_only`
 *   (before anything is read) and for a read FxTwitter does not offer; an
 *   outcome's value is returned whichever kind it is, and its errors propagate.
 * - `account`, or `auto` under `account_only` or for a read FxTwitter does not
 *   offer, reads only the reading account.
 * - `auto` reads FxTwitter first. An `answer` is returned. A `fallback`, and a
 *   `ToolError` that names FxTwitter as its source (down, limiting, failing in
 *   a row), go to the reading account when one is set up; without one,
 *   FxTwitter's value stands and the error is thrown again. Any other error
 *   (an abort, `internal_error`, the call's budget) propagates.
 *
 * The reading account's own errors always propagate.
 */
export async function readFromSources<T>(
  reader: Reader,
  source: Source = "auto",
  read: SourcedRead<T>,
): Promise<Sourced<T>> {
  const { fxtwitter } = read
  const viaAccount = async (): Promise<Sourced<T>> => ({ source: "account", value: await read.account(reader) })

  if (source === "fxtwitter") {
    if (reader.accountOnly) throw new ToolError("invalid_argument", ACCOUNT_ONLY_MESSAGE)
    if (!fxtwitter) throw new ToolError("invalid_argument", NOT_OFFERED_MESSAGE)
    const outcome = await fxtwitter(reader.fxtwitter())
    return { source: "fxtwitter", value: outcome.value }
  }
  if (source === "account" || reader.accountOnly || !fxtwitter) return viaAccount()

  let outcome: FxOutcome<T>
  try {
    outcome = await fxtwitter(reader.fxtwitter())
  } catch (error) {
    if (isFxTwitterFailure(error) && (await reader.hasAccount())) return viaAccount()
    throw error
  }
  if (outcome.kind === "answer" || !(await reader.hasAccount())) return { source: "fxtwitter", value: outcome.value }
  return viaAccount()
}
