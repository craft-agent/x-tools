import { lstat, mkdir, realpath, rmdir } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { ToolError } from "../errors"
import { isWithinPlanned } from "../paths"
import type { ToolContext } from "../tool"

/** The directories a download directory must stay out of, as the call's context names them. */
type KeptDirs = Pick<ToolContext, "stateDir" | "ownDir">

/** The folder a post's media go in, and whether this call made it. */
export type PostFolder = { path: string; created: boolean }

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined
}

/** The download directory of the call: `internal_error` when the entry point gave none, or a relative one. */
export function requireDownloadDir(ctx: Pick<ToolContext, "downloadDir">): string {
  const { downloadDir } = ctx
  if (downloadDir === undefined || !isAbsolute(downloadDir)) {
    throw new ToolError("internal_error", "Media downloads require an absolute download directory.")
  }
  return downloadDir
}

/**
 * Refuses a download directory that is, or lies inside, the state directory or
 * the install directory (`forbidden`, naming the setting and no path), judged by
 * real path: a directory that does not exist yet by the real path of its
 * nearest existing ancestor. One that cannot be judged is `internal_error`.
 */
export async function checkDownloadDir(downloadDir: string, kept: KeptDirs): Promise<void> {
  for (const dir of [kept.stateDir, kept.ownDir]) {
    if (dir === undefined) continue
    let inside: boolean
    try {
      inside = await isWithinPlanned(downloadDir, dir)
    } catch (cause) {
      throw new ToolError("internal_error", "The download directory could not be checked.", { cause })
    }
    if (inside) {
      throw new ToolError(
        "forbidden",
        "The download_dir setting names the directory where the tools keep their own files, or one inside it; set it to another directory.",
      )
    }
  }
}

function folderError(cause: unknown): ToolError {
  return new ToolError("internal_error", "The download folder could not be created.", { cause })
}

function notPlainFolder(): ToolError {
  return new ToolError(
    "forbidden",
    "The post's folder is not a plain directory directly inside the download_dir directory.",
  )
}

/** Throws unless `folder` is a real directory, not a link, whose real path lies directly in `realDir`. */
async function requirePlainFolder(folder: string, realDir: string): Promise<void> {
  const stats = await lstat(folder)
  if (!stats.isDirectory() || dirname(await realpath(folder)) !== realDir) throw notPlainFolder()
}

/**
 * Makes the download directory and the post's folder in it, refusing both as
 * `forbidden` where they are not allowed: the real path of the directory once
 * it exists is checked again, and the folder must be a directory, not a link,
 * directly inside it. A folder that is already there is used as it is.
 */
export async function preparePostFolder(downloadDir: string, id: string, kept: KeptDirs): Promise<PostFolder> {
  try {
    await mkdir(downloadDir, { recursive: true })
  } catch (cause) {
    throw folderError(cause)
  }
  await checkDownloadDir(downloadDir, kept)

  const path = join(downloadDir, id)
  let created = true
  try {
    await mkdir(path)
  } catch (cause) {
    if (errorCode(cause) !== "EEXIST") throw folderError(cause)
    created = false
  }
  const folder: PostFolder = { path, created }
  try {
    await requirePlainFolder(path, await realpath(downloadDir))
  } catch (error) {
    await removeIfEmpty(folder)
    throw error instanceof ToolError ? error : folderError(error)
  }
  return folder
}

/** Removes the folder when this call made it and it is still empty; it never touches one that was there before. */
export async function removeIfEmpty(folder: PostFolder): Promise<void> {
  if (folder.created) await rmdir(folder.path).catch(() => {})
}
