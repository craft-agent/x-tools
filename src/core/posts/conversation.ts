import { readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { readConversationFromAccount } from "./account.conversation"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { checkSources } from "./check-sources"
import { readConversationFromFxTwitter } from "./fxtwitter.conversation"
import { parsePostRef } from "./refs"
import { DEFAULT_SORT, UNTRUSTED_NOTE, type PostReadInput, type PostReadOutput } from "./schemas"

/**
 * Reads the conversation of the post `args.post` names (an id or a URL): the
 * post, the posts it replies to (`ancestors`, root first, on the first page)
 * and a page of its direct replies as `results`, by likes (`sort` `top`, the
 * default) or newest first (`latest`). The page size is the source's, so there
 * is no `limit`; its `cursor` is null at the end, and a cursor continues only
 * this post and `sort` on the source that gave it.
 *
 * The sources are checked before anything is read, as `readPostList` does.
 * A post that is not there comes back with its `status` and `reason`, nothing
 * else, and no cursor. `invalid_argument` for an argument `conversation` does
 * not take, a missing or malformed post, and a cursor that belongs to another
 * read, post or `sort`.
 */
export async function conversationOfPost(args: PostReadInput, reader: Reader): Promise<PostReadOutput> {
  refuseForeignArguments(args)
  const { id } = parsePostRef(requireArgument(args, "post"), "post")
  const sort = args.sort ?? DEFAULT_SORT
  await checkSources(args, reader)
  const page = await readPage(
    reader,
    { read: "conversation", args: { post: id, sort }, source: args.source, cursor: args.cursor },
    {
      fxtwitter: (client, cursor) => readConversationFromFxTwitter(client, id, { sort, cursor, now: reader.now }),
      account: (accountReader, cursor) =>
        readConversationFromAccount(accountReader, id, { sort, cursor, account: args.account }),
    },
  )
  return {
    method: "conversation",
    status: page.status,
    reason: page.reason,
    post: page.post,
    ancestors: page.ancestors,
    results: page.items,
    source: page.source,
    cursor: page.cursor,
    note: UNTRUSTED_NOTE,
  }
}
