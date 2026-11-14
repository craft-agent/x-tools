import { isAbsolute, join } from "node:path"
import { ToolError } from "../errors"
import { createFxClient, type FxClient } from "../fxtwitter/client"
import { fxPaceSettings } from "../fxtwitter/pacing"
import type { Connect } from "../fxtwitter/transport"
import type { ToolContext } from "../tool"
import { listLabels } from "../x/labels"
import { DEFAULT_LOCK_WAIT_MS } from "../x/read-lock"
import { readX, type ReadOptions } from "../x/read"
import { accountOnly } from "./source"

/** How long one tool call may spend reading, over both sources. */
export const CALL_BUDGET_MS = 150_000

/** The reading account's answer: its label and the bridge operation's data. */
type AccountAnswer = { account: string; data: unknown }

/** What a test replaces in a reader; each has a default. */
export type ReaderOverrides = {
  /** The clock in epoch milliseconds; defaults to the runtime's. */
  now?: () => number
  /** Waits `ms`, rejecting with an `AbortError` when `signal` aborts; defaults to a timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Sends FxTwitter's requests elsewhere; defaults to `https.request`. */
  connect?: Connect
  /** The time limit of one FxTwitter request; defaults to FxTwitter's own. */
  fxTimeoutMs?: number
  /** The call's time budget; defaults to `CALL_BUDGET_MS`. */
  budgetMs?: number
  /** Stands in for `readX`. */
  readAccount?: (options: ReadOptions) => Promise<AccountAnswer>
}

/** What one tool call reads through: both sources, the call's time budget and the settings in force. */
export type Reader = {
  /** Whether the `account_only` setting turns FxTwitter off. */
  readonly accountOnly: boolean
  /** The milliseconds left of the call's budget, never below 0. */
  remainingMs(): number
  /** Throws `rate_limited` (`details.reason: "call_budget"`) when no time is left. */
  checkBudget(): void
  /** This call's FxTwitter client, made on first use; each request checks the budget. Throws `internal_error` under `account_only`. */
  fxtwitter(): FxClient
  /** Whether at least one reading account is set up; asked once. */
  hasAccount(): Promise<boolean>
  /** One read of X through the reading account `account` (the only one when left out), after the budget check. */
  account(op: string, args: Readonly<Record<string, unknown>>, account?: string): Promise<AccountAnswer>
}

function budgetError(): ToolError {
  return new ToolError(
    "rate_limited",
    "This call ran out of its time before it could read this; ask again for what is left.",
    { details: { reason: "call_budget" } },
  )
}

/**
 * The reader of one tool call. The call's deadline is set here, `CALL_BUDGET_MS`
 * from now; every request to FxTwitter and every read of the reading account
 * first checks it, and a wait for another read's lock never runs past it.
 * Needs the runtime and an absolute state directory (`internal_error`
 * otherwise); the install directory is needed only for a read of the account.
 */
export function createReader(ctx: ToolContext, overrides: ReaderOverrides = {}): Reader {
  const { runtime, stateDir } = ctx
  if (!runtime || !stateDir || !isAbsolute(stateDir)) {
    throw new ToolError("internal_error", "Reads require a runtime and an absolute state directory.")
  }
  const now = overrides.now ?? runtime.now
  const deadline = now() + (overrides.budgetMs ?? CALL_BUDGET_MS)
  const onlyAccount = accountOnly(ctx.options)
  let client: FxClient | undefined
  let accountExists: Promise<boolean> | undefined

  const remainingMs = () => Math.max(0, deadline - now())
  const checkBudget = () => {
    if (remainingMs() <= 0) throw budgetError()
  }
  const lockWaitMs = () => Math.min(DEFAULT_LOCK_WAIT_MS, remainingMs())

  const makeClient = (): FxClient => {
    if (onlyAccount) {
      throw new ToolError("internal_error", "FxTwitter is off under the account_only setting and must not be read.")
    }
    const made = createFxClient({
      stateDir,
      userAgent: runtime.userAgent,
      settings: fxPaceSettings(ctx.options),
      signal: ctx.signal,
      now,
      sleep: overrides.sleep,
      connect: overrides.connect,
      timeoutMs: overrides.fxTimeoutMs,
      lockWaitMs: lockWaitMs(),
    })
    return {
      async get(path) {
        checkBudget()
        return made.get(path)
      },
      failures: () => made.failures(),
    }
  }

  return {
    accountOnly: onlyAccount,
    remainingMs,
    checkBudget,
    fxtwitter: () => (client ??= makeClient()),
    hasAccount: () => (accountExists ??= listLabels(stateDir).then((labels) => labels.length > 0)),
    async account(op, args, account) {
      checkBudget()
      const { ownDir } = ctx
      if (!ownDir || !isAbsolute(ownDir)) {
        throw new ToolError("internal_error", "Reads of the reading account require an absolute install directory.")
      }
      const readAccount = overrides.readAccount ?? readX
      return readAccount({
        stateDir,
        account,
        envPrefix: runtime.envPrefix,
        env: runtime.env,
        bridgeFile: join(ownDir, "engine", "bridge.py"),
        op,
        args,
        options: ctx.options,
        signal: ctx.signal,
        now,
        sleep: overrides.sleep,
        lockWaitMs: lockWaitMs(),
      })
    },
  }
}
