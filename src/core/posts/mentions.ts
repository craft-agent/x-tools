import { ToolError } from "../errors"
import type { Reader } from "../sources/reader"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { parseHandle } from "./handle"
import { readPostList, searchList } from "./list"
import type { PostReadInput, PostReadOutput } from "./schemas"

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** `input` when it is a calendar day written `YYYY-MM-DD`; `invalid_argument` naming `argName` otherwise, never echoing it. */
function parseDay(input: string, argName: string): string {
  const parts = DAY_PATTERN.exec(input)
  if (parts) {
    const [year, month, day] = parts.slice(1).map(Number) as [number, number, number]
    const date = new Date(Date.UTC(year, month - 1, day))
    // Date.UTC rolls 2026-02-30 over to March, and reads years 0 to 99 as 19xx: neither is the day written.
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return input
  }
  throw new ToolError("invalid_argument", `${argName} is not a day written YYYY-MM-DD.`)
}

/** The search for the posts that mention `handle`, from `since` on: `@<handle> -from:<handle>`, then ` since:<day>`. */
function mentionsQuery(handle: string, since: string | undefined): string {
  return `@${handle} -from:${handle}${since === undefined ? "" : ` since:${since}`}`
}

/**
 * Reads the posts mentioning `args.handle`, newest first, from the day
 * `args.since` on when given; a page, as `readPostList` reads it. It is the
 * search `@<handle> -from:<handle>` (and ` since:<day>`) on either source, in
 * the latest feed, lowercase handle and all, so it misses what X's search
 * misses. `invalid_argument` for an argument `mentions` does not take, a
 * missing or malformed handle, a `since` that is no calendar day, and a
 * cursor that belongs to another read.
 */
export async function mentionsOfAccount(args: PostReadInput, reader: Reader): Promise<PostReadOutput> {
  refuseForeignArguments(args)
  const handle = parseHandle(requireArgument(args, "handle"), "handle").toLowerCase()
  const since = args.since === undefined ? undefined : parseDay(args.since, "since")
  const query = mentionsQuery(handle, since)
  return readPostList(args, reader, searchList("mentions", { handle, since: since ?? null }, query))
}
