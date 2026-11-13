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
}
