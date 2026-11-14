import type { ToolOptions } from "../tool"
import { cookieFingerprint, cookieVariable, readCookies } from "./cookies"
import { callEngine, engineOutcome, requireEngine } from "./engine-call"
import { pickLabel } from "./labels"
import { pacedCall } from "./paced-call"
import { paceSettings } from "./pacing"

/** What `readX` needs. */
export type ReadOptions = {
  stateDir: string
  /** The reading account's label; left out, the only one. */
  account?: string
  /** The prefix of the cookie variable's name. */
  envPrefix: string
  env: Readonly<Record<string, string | undefined>>
  /** `<package root>/engine/bridge.py` */
  bridgeFile: string
  /** The bridge operation to run. */
  op: string
  args?: Readonly<Record<string, unknown>>
  /** The package's own settings; the pacing settings are read from here. */
  options?: ToolOptions
  signal?: AbortSignal
  /** The clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** Waits `ms`, rejecting with an `AbortError` when `signal` aborts; defaults to a timer. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** How long to wait for another read of the label to finish; defaults to 90 s. */
  lockWaitMs?: number
}

/**
 * The one way a read reaches X: picks the reading account, takes its cookies
 * (the variable first, then its file), checks that the engine is installed,
 * and runs the operation through the account's pacing (`pacedCall`). Returns
 * the label that answered and the operation's data; a failed reply is thrown
 * as the `ToolError` `engineOutcome` maps it to.
 *
 * Nothing is locked, waited for or counted when there is no account, no
 * usable cookies or no engine; those fail first.
 */
export async function readX(options: ReadOptions): Promise<{ account: string; data: unknown }> {
  const now = options.now ?? Date.now
  const paths = await pickLabel(options.stateDir, options.account)
  const cookies = await readCookies({
    paths,
    variable: cookieVariable(options.envPrefix, paths.label),
    env: options.env,
  })

  await requireEngine(options.stateDir)

  const reply = await pacedCall({
    paths,
    settings: paceSettings(options.options),
    fingerprint: cookieFingerprint(cookies.value),
    call: (refused) =>
      callEngine({
        stateDir: options.stateDir,
        bridgeFile: options.bridgeFile,
        op: options.op,
        args: options.args,
        cookies: cookies.value,
        refused,
        env: options.env,
        signal: options.signal,
      }),
    signal: options.signal,
    now: options.now,
    sleep: options.sleep,
    lockWaitMs: options.lockWaitMs,
  })
  return { account: paths.label, data: engineOutcome(reply, now()) }
}
