import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import type { ToolOptions } from "../core"
import type { EntryProfile } from "./profile"

/** The name of the state directory setting among the package's own options. */
export const STATE_DIR_OPTION = "state_dir"

/** The environment a setting is read from. */
export type Environment = Record<string, string | undefined>

/** Where every reading account's state and the engine live, resolved. */
export type StateDirSettings = { state_dir: string }

/** The part of a call's context that the state directory setting gives. */
export type StateDirContext = { stateDir: string }

/** The home directory: `env.HOME` when absolute, else the user's. */
export function homeOf(env: Environment): string {
  return env.HOME !== undefined && isAbsolute(env.HOME) ? env.HOME : homedir()
}

/** The state directory when no setting names one: `<XDG_STATE_HOME>/<name>` when that variable is absolute, else `<home>/.local/state/<name>`. */
export function defaultStateDir(env: Environment, profile: EntryProfile): string {
  const state = env.XDG_STATE_HOME
  const stateHome = state !== undefined && isAbsolute(state) ? state : join(homeOf(env), ".local", "state")
  return join(stateHome, profile.name)
}

/** Hands the state directory setting to a tool as the context field it becomes. */
export function stateDirContext(settings: StateDirSettings): StateDirContext {
  return { stateDir: settings.state_dir }
}

/**
 * Resolves the `state_dir` setting from the tool options the parsers read,
 * filling in the default when it is unset. Creates nothing and checks no real path.
 */
export function stateDirSettings(options: ToolOptions, env: Environment, profile: EntryProfile): StateDirSettings {
  const given = options[STATE_DIR_OPTION]
  return { state_dir: typeof given === "string" ? given : defaultStateDir(env, profile) }
}
