import { createInterface } from "node:readline/promises"
import { abortError, isAbortError } from "../core"
import type { EntryProfile } from "../entry/profile"

/** The exit codes of a command: it did its work, the work failed, or the command line was wrong. */
export const EXIT_OK = 0
export const EXIT_FAILED = 1
export const EXIT_USAGE = 2

/** What a command of the command line needs from its surroundings; `main.ts` wires the process, a test supplies its own. */
export type CommandIo = {
  /** Where the `<envPrefix>_*` settings fall back to. */
  env: Record<string, string | undefined>
  /** The settings' environment prefix and the toolsets; defaults to this package's. */
  profile?: EntryProfile
  /** Receives what a command says to the person, or the JSON document a command answers with. */
  stdout(text: string): void
  /** Receives usage lines, errors, progress and the detail of unexpected errors. */
  stderr(text: string): void
  /** Where the tools are installed: never a call's working tree. */
  ownDir?: string
  /** Stops a running command when it aborts. */
  signal?: AbortSignal
  /** Whether standard input is an interactive terminal; defaults to the process's own. */
  isTTY?: boolean
  /** Asks the person one question and reads the answer; `undefined` when there is none. Defaults to `defaultReadLine`. */
  readLine?(prompt: string): Promise<string | undefined>
}

/** Throws the `AbortError` of `signal` when it has aborted, whatever reason it carries. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal)
}

/**
 * Asks one question on the terminal and reads one line from standard input.
 * The prompt goes to standard error, so standard output stays for results.
 * Resolves to `undefined` when input ends or `signal` aborts, never hangs.
 */
export async function defaultReadLine(prompt: string, signal?: AbortSignal): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const ended = new Promise<undefined>((resolve) => rl.once("close", () => resolve(undefined)))
  try {
    return await Promise.race([rl.question(prompt, { signal }), ended])
  } catch (error) {
    if (isAbortError(error)) return undefined
    throw error
  } finally {
    rl.close()
  }
}
