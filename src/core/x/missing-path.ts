/** Whether a file system error says the path, or a directory on the way to it, is not there. */
export function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === "ENOENT" || code === "ENOTDIR"
}
