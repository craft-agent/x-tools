import { chmod, lstat, mkdir } from "node:fs/promises"
import type { Stats } from "node:fs"
import { ToolError } from "../errors"

/** Mode of the directories the package creates in its state root: owner only. */
const DIR_MODE = 0o700

async function statOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

/** Refuses what stands at `dir` when it is a symlink or anything but a directory; nothing there is fine. */
async function refuseNonDirectory(dir: string): Promise<void> {
  const stat = await statOrUndefined(dir)
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw new ToolError("invalid_argument", `"${dir}" exists and is not a directory (a symlink is not followed).`)
  }
}

/**
 * Creates `dir` and any missing parent with mode 700 and sets `dir` itself to
 * 700 even when it existed (`mkdir` applies the umask). A symlink or a
 * non-directory at `dir` is refused with `invalid_argument` and never followed.
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await refuseNonDirectory(dir)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  // A symlink put in place after the first check must not receive the chmod.
  await refuseNonDirectory(dir)
  await chmod(dir, DIR_MODE)
}
