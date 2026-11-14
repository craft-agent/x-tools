import { ToolError } from "../errors"
import type { Reader } from "../sources/reader"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { readPostList, searchList } from "./list"
import { DEFAULT_FEED, type PostReadInput, type PostReadOutput } from "./schemas"

/**
 * Searches posts for `args.query`, X's search syntax passed as written, in
 * `args.feed` (`latest` by default); a page, as `readPostList` reads it.
 * `invalid_argument` for an argument `search` does not take, a missing or
 * blank query, and a cursor that belongs to another read.
 */
export async function searchPosts(args: PostReadInput, reader: Reader): Promise<PostReadOutput> {
  refuseForeignArguments(args)
  const query = requireArgument(args, "query")
  if (query.trim() === "") throw new ToolError("invalid_argument", "query must not be empty.")
  const feed = args.feed ?? DEFAULT_FEED
  return readPostList(args, reader, searchList("search", { query, feed }, query, feed))
}
