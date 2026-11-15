import { expect } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { isToolError, type GrantContext } from "../core"
import type { DownloadDirSettings } from "./download-dir"
import { NOTE_OPTION } from "./options.testing"
import type { EntryProfile } from "./profile"
import type { StateDirSettings } from "./state-dir"

/** Fixtures the settings tests share. */

export const profile: EntryProfile = {
  name: "demo-tools",
  envPrefix: "DEMO",
  toolsets: { names: ["alpha", "beta", "gamma"], defaults: ["alpha"] },
  options: { [NOTE_OPTION]: "text", state_dir: "path", download_dir: "path" },
}

/** The grants' context of settings that name no grant setting, read from an environment without `HOME` or `XDG_STATE_HOME`. */
export const DEFAULT_GRANTS: GrantContext = {
  unattended: false,
  dir: join(homedir(), ".local", "state", profile.name, "grants"),
  key: undefined,
}

/** The state and download directories of settings that name none, read from an environment without `HOME` or `XDG_STATE_HOME`. */
export const DEFAULT_STATE: StateDirSettings & DownloadDirSettings = {
  state_dir: join(homedir(), ".local", "state", profile.name),
  download_dir: join(homedir(), "Downloads", profile.name),
}

export function failure(run: () => unknown): Error {
  try {
    run()
  } catch (error) {
    expect(isToolError(error) && error.code).toBe("invalid_argument")
    return error as Error
  }
  throw new Error("expected the settings to be rejected")
}
