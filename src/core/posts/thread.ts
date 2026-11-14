import { readFromSources } from "../sources/choose"
import type { Reader } from "../sources/reader"
import { readThreadFromAccount } from "./account.conversation"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { checkSources } from "./check-sources"
import { readThreadFromFxTwitter } from "./fxtwitter.conversation"
import { parsePostRef } from "./refs"
import { UNTRUSTED_NOTE, type PostReadInput, type PostReadOutput } from "./schemas"

/**
 * Reads the thread of the post `args.post` names (an id or a URL): the chain
 * of posts its author wrote, oldest first, as `results`. X gives it whole, so
 * there is no `limit` or `cursor` and the result's `cursor` is null. A post
 * that is not there comes back with its `status` and `reason`, and no posts.
 * The sources are checked before anything is read, as `viewPosts` does;
 * `invalid_argument` for an argument `thread` does not take and a missing or
 * malformed post.
 */
export async function threadOfPost(args: PostReadInput, reader: Reader): Promise<PostReadOutput> {
  refuseForeignArguments(args)
  const { id } = parsePostRef(requireArgument(args, "post"), "post")
  await checkSources(args, reader)
  const { source, value } = await readFromSources(reader, args.source, {
    fxtwitter: (client) => readThreadFromFxTwitter(client, id, reader.now),
    account: (accountReader) => readThreadFromAccount(accountReader, id, args.account),
  })
  return {
    method: "thread",
    status: value.status,
    reason: value.reason,
    results: value.posts,
    source,
    cursor: null,
    note: UNTRUSTED_NOTE,
  }
}
