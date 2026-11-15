import { accountRowsPageOf } from "../posts/account.list"
import { checkSources } from "../posts/check-sources"
import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { ACCOUNT_USER_ROWS } from "../users/account"
import { LIST_MEMBERS_OPERATION, listNotFound } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { parseListRef } from "./refs"
import { UNTRUSTED_NOTE, type ListReadInput, type ListReadOutput } from "./schemas"

/**
 * Reads the members of the list `args.list` names (an id or a URL), a page of
 * at most `args.limit` users (20 by default) in X's order; its `cursor` is
 * null at the end and continues only this list on the reading account.
 * FxTwitter has no list route, so `source: fxtwitter` is refused and `auto`
 * reads the account: one read of the bridge's `list_members` operation.
 *
 * Checked and failing as `listPosts` does, a cursor of the same list's posts
 * included.
 */
export async function listMembers(args: ListReadInput, reader: Reader): Promise<ListReadOutput> {
  refuseForeignArguments(args)
  const id = parseListRef(requireArgument(args, "list"), "list")
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const page = await readPage(
    reader,
    { read: "list_members", args: { list: id }, source: args.source, cursor: args.cursor },
    {
      account: async (accountReader, cursor) => {
        const { data } = await accountReader.account(LIST_MEMBERS_OPERATION, { id, count: limit, cursor }, args.account)
        if (data === null) throw listNotFound()
        return accountRowsPageOf(data, limit, accountReader.now, ACCOUNT_USER_ROWS)
      },
    },
  )
  return { method: "members", users: page.items, source: page.source, cursor: page.cursor, note: UNTRUSTED_NOTE }
}
