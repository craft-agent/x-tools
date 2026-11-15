import { join } from "node:path"
import type { ToolOptions } from "../core"
import type { EntryProfile } from "./profile"
import { homeOf, type Environment } from "./state-dir"

/** The name of the download directory setting among the package's own options. */
export const DOWNLOAD_DIR_OPTION = "download_dir"

const DOWNLOADS_DIR_NAME = "Downloads"

/** Where downloaded media are saved, resolved. */
export type DownloadDirSettings = { download_dir: string }

/** The part of a call's context that the download directory setting gives. */
export type DownloadDirContext = { downloadDir: string }

/** The download directory when no setting names one: `<home>/Downloads/<name>`. */
export function defaultDownloadDir(env: Environment, profile: EntryProfile): string {
  return join(homeOf(env), DOWNLOADS_DIR_NAME, profile.name)
}

/** Hands the download directory setting to a tool as the context field it becomes. */
export function downloadDirContext(settings: DownloadDirSettings): DownloadDirContext {
  return { downloadDir: settings.download_dir }
}

/**
 * Resolves the `download_dir` setting from the tool options the parsers read,
 * filling in the default when it is unset. Creates nothing and checks no real path.
 */
export function downloadDirSettings(
  options: ToolOptions,
  env: Environment,
  profile: EntryProfile,
): DownloadDirSettings {
  const given = options[DOWNLOAD_DIR_OPTION]
  return { download_dir: typeof given === "string" ? given : defaultDownloadDir(env, profile) }
}
