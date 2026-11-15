import { realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"

/** Whether the real path `path` is `root` or inside it. */
function isInside(path: string, root: string): boolean {
  const from = relative(root, path)
  return from === "" || !(from === ".." || from.startsWith(`..${sep}`) || isAbsolute(from))
}

/** Whether `dir` is `root` or inside it, compared by real path; a path that cannot be resolved is not. */
export async function isWithin(dir: string, root: string): Promise<boolean> {
  try {
    return isInside(await realpath(dir), await realpath(root))
  } catch {
    return false
  }
}

/** Whether a `realpath` failure says only that the path, or a part of it, is not there. */
function isMissing(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? error.code : undefined
  return code === "ENOENT" || code === "ENOTDIR"
}

/**
 * The real path of the absolute `path`, whether or not it exists yet: the real
 * path of its nearest existing ancestor, with the parts that are missing
 * appended as they are written. A link in the part that exists is followed, so
 * a path through one is judged by where it leads. Rejects with what `realpath`
 * does for any other failure, such as a link loop or a directory that cannot be read.
 */
async function realPathOfPlanned(path: string): Promise<string> {
  const missing: string[] = []
  let existing = path
  for (;;) {
    try {
      return join(await realpath(existing), ...missing)
    } catch (error) {
      const parent = dirname(existing)
      if (!isMissing(error) || parent === existing) throw error
      missing.unshift(basename(existing))
      existing = parent
    }
  }
}

/**
 * Whether `path` is `root` or inside it, compared by real path as `isWithin`
 * does, but where either may not exist yet: each is judged by the real path of
 * its nearest existing ancestor with the missing parts appended. Rejects when
 * a path cannot be resolved for a reason other than being absent.
 */
export async function isWithinPlanned(path: string, root: string): Promise<boolean> {
  return isInside(await realPathOfPlanned(path), await realPathOfPlanned(root))
}
