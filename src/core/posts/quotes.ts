import type { Reader } from "../sources/reader"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { readPostList } from "./list"
import { parsePostRef } from "./refs"
import { DEFAULT_FEED, type PostReadInput, type PostReadOutput } from "./schemas"

/**
 * Reads the posts quoting the post `args.post` names (an id or a URL), newest
 * first; a page, as `readPostList` reads it. The reading account finds them
 * with the search `quoted_tweet_id:<id>`. `invalid_argument` for an argument
 * `quotes` does not take, a missing or malformed post, and a cursor that
 * belongs to another read.
 */
export async function quotesOfPost(args: PostReadInput, reader: Reader): Promise<PostReadOutput> {
  refuseForeignArguments(args)
  const { id } = parsePostRef(requireArgument(args, "post"), "post")
  return readPostList(args, reader, {
    method: "quotes",
    cursorArgs: { post: id },
    fxtwitter: { path: `/2/status/${id}/quotes`, params: {} },
    account: { query: `quoted_tweet_id:${id}`, feed: DEFAULT_FEED },
  })
}
