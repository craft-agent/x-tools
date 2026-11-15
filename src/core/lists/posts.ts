import { accountPageOf } from "../posts/account.list"
import { checkSources } from "../posts/check-sources"
import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { LIST_POSTS_OPERATION, listNotFound } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { parseListRef } from "./refs"
import { UNTRUSTED_NOTE, type ListReadInput, type ListReadOutput } from "./schemas"

/**
 * Reads the latest posts of the list `args.list` names (an id or a URL), a
 * page of at most `args.limit` posts (20 by default) in X's order, each in the
 * shape of any post (a community note `unknown`); its `cursor` is null at the
 * end and continues only this list on the reading account. FxTwitter has no
 * list route, so `source: fxtwitter` is refused and `auto` reads the account:
 * one read of the bridge's `list_posts` operation.
 *
 * The sources are checked before anything is read, as `repostersOfPost` does.
 * `invalid_argument` for an argument `posts` does not take, a missing or
 * malformed list, and a cursor that belongs to another read or list, the
 * members' of the same list included; `not_found` for a list the reading
 * account cannot see.
 */
export async function listPosts(args: ListReadInput, reader: Reader): Promise<ListReadOutput> {
  refuseForeignArguments(args)
  const id = parseListRef(requireArgument(args, "list"), "list")
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const page = await readPage(
    reader,
    { read: "list_posts", args: { list: id }, source: args.source, cursor: args.cursor },
    {
      account: async (accountReader, cursor) => {
        const { data } = await accountReader.account(LIST_POSTS_OPERATION, { id, count: limit, cursor }, args.account)
        if (data === null) throw listNotFound()
        return accountPageOf(data, limit, accountReader.now)
      },
    },
  )
  return { method: "posts", posts: page.items, source: page.source, cursor: page.cursor, note: UNTRUSTED_NOTE }
}
