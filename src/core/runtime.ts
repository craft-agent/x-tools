import { isAbsolute } from "node:path"
import { ToolError } from "./errors"

/** The identity and environment an entry point supplies to a tool beside the call's own context. */
export type ToolRuntime = {
  /** The prefix of the package's variables, such as the one a reading account's cookies are read from. */
  envPrefix: string
  /** The command line a person runs, as a recovery command names it. */
  cli: string
  /** The environment a tool reads its variables from. */
  env: Readonly<Record<string, string | undefined>>
  /** What a request to a third party sends as `User-Agent`: the package's name, version and where it lives. */
  userAgent: string
  /** The clock in epoch milliseconds. */
  now: () => number
}

/** The call's `runtime` and `stateDir`, or `internal_error` when either is missing or `stateDir` is relative. */
export function requireRuntime(
  ctx: { runtime?: ToolRuntime; stateDir?: string },
  subject: string,
): { runtime: ToolRuntime; stateDir: string } {
  const { runtime, stateDir } = ctx
  if (!runtime || !stateDir || !isAbsolute(stateDir)) {
    throw new ToolError("internal_error", `${subject} require a runtime and an absolute state directory.`)
  }
  return { runtime, stateDir }
}
