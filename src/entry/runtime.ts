import type { ToolRuntime } from "../core"
import { PROJECT } from "../project"
import { PROJECT_PROFILE, type EntryProfile } from "./profile"
import type { Environment } from "./state-dir"

/** What an entry point may replace in the runtime it gives its tools; each has a default, and a test supplies its own. */
export type RuntimeOptions = {
  /** The settings' environment prefix and the toolsets; defaults to this package's. */
  profile?: EntryProfile
  /** The environment the tools read their variables from; defaults to `process.env`. */
  env?: Environment
  /** The clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number
}

/** The runtime of a tool call: the profile's variable prefix, the package's command line, the environment and the clock. It reads nothing. */
export function createToolRuntime(options: RuntimeOptions = {}): ToolRuntime {
  const profile = options.profile ?? PROJECT_PROFILE
  return {
    envPrefix: profile.envPrefix,
    cli: PROJECT.cli,
    env: options.env ?? process.env,
    now: options.now ?? Date.now,
  }
}
