import { randomUUID } from "node:crypto"
import type { BigIntStats } from "node:fs"
import { lstat, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { ToolError } from "../errors"
import { isWithin } from "../paths"
import { labelPaths, stateRoot, type LabelPaths } from "./labels"
import { isMissingPath } from "./missing-path"
import { tryReadLock } from "./read-lock"

/** What removing one label needs. */
export type RemoveLabelOptions = {
  stateDir: string
  label: string
}

/** The label directory as it was found, to tell it from anything put in its place. */
type DirectoryIdentity = Pick<BigIntStats, "dev" | "ino">

async function lstatIfPresent(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true })
  } catch (error) {
    if (isMissingPath(error)) return undefined
    throw error
  }
}

function isSameDirectory(stats: BigIntStats | undefined, identity: DirectoryIdentity): boolean {
  return stats !== undefined && stats.isDirectory() && stats.dev === identity.dev && stats.ino === identity.ino
}

/** The label's directory before anything is changed: `not_found` when missing, `invalid_argument` when it is a symlink or not a directory. */
async function findLabelDir(paths: LabelPaths): Promise<DirectoryIdentity> {
  const stats = await lstatIfPresent(paths.dir)
  if (!stats) throw new ToolError("not_found", `Reading account "${paths.label}" was not found; nothing was removed.`)
  if (!stats.isDirectory()) {
    throw new ToolError(
      "invalid_argument",
      `Label directory "${paths.dir}" is not a real directory; nothing was removed.`,
    )
  }
  return { dev: stats.dev, ino: stats.ino }
}

/** Throws `stale` unless the label's path still names the directory found first, inside the state root. */
async function requireSameDir(paths: LabelPaths, stateDir: string, identity: DirectoryIdentity): Promise<void> {
  if (!isSameDirectory(await lstatIfPresent(paths.dir), identity) || !(await isWithin(paths.dir, stateDir))) {
    throw new ToolError(
      "stale",
      `The state of "${paths.label}" changed while it was being removed; nothing was deleted. Check it and remove it again.`,
    )
  }
}

/**
 * Removes one reading account's local state: its cookie file, the reads
 * counted, X's remembered verdicts and its handle → user id cache. This deletes local files only, and
 * sends nothing to X.
 *
 * The label must exist as a real directory (`not_found`, `invalid_argument`).
 * The read lock is then taken once: a label with a read still running throws
 * `invalid_argument` and stays intact. Under the lock the directory, which
 * must still be the one first found, is renamed out of the label namespace
 * (a name that is no valid label, so no listing shows it), so a read waiting
 * on the lock cannot write into state being removed, and only that detached
 * directory is deleted. A directory missing or replaced meanwhile is `stale`
 * and nothing is deleted. A failed deletion throws `upstream_error` naming
 * the detached directory and rolls nothing back, since the label may belong
 * to a new account by then.
 */
export async function removeLabel({ stateDir, label }: RemoveLabelOptions): Promise<void> {
  const paths = labelPaths(stateDir, label)
  const identity = await findLabelDir(paths)

  const release = tryReadLock(paths.lock)
  if (!release) {
    throw new ToolError("invalid_argument", "A read of this reading account is still running; try again when it ends.")
  }

  const detached = join(stateRoot(stateDir).accounts, `.removed-${label}-${randomUUID()}`)
  try {
    await requireSameDir(paths, stateDir, identity)
    await rename(paths.dir, detached)
  } finally {
    release()
  }

  if (!isSameDirectory(await lstatIfPresent(detached), identity)) {
    throw new ToolError(
      "stale",
      `The state of "${label}" changed while it was being removed; "${detached}" was left as it is.`,
    )
  }
  try {
    await rm(detached, { recursive: true, force: true })
  } catch (error) {
    throw new ToolError(
      "upstream_error",
      `The state of "${label}" was detached but not fully deleted; delete "${detached}" by hand: ${(error as Error).message}`,
      { cause: error },
    )
  }
}
