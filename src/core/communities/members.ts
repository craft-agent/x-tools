import { accountRowsPageOf } from "../posts/account.list"
import { checkSources } from "../posts/check-sources"
import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { ACCOUNT_USER_ROWS } from "../users/account"
import { COMMUNITY_MEMBERS_OPERATION, communityNotFound } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { parseCommunityRef } from "./refs"
import { UNTRUSTED_NOTE, type CommunityReadInput, type CommunityReadOutput } from "./schemas"

/**
 * Reads the members of the community `args.community` names (an id or a URL),
 * a page of at most `args.limit` users (20 by default) in X's order; its
 * `cursor` is null at the end and continues only this community on the
 * reading account. FxTwitter has no community route, so `source: fxtwitter`
 * is refused and `auto` reads the account: one read of the bridge's
 * `community_members` operation.
 *
 * Checked and failing as `communityPosts` does, a cursor of the same
 * community's posts included.
 */
export async function communityMembers(args: CommunityReadInput, reader: Reader): Promise<CommunityReadOutput> {
  refuseForeignArguments(args)
  const id = parseCommunityRef(requireArgument(args, "community"), "community")
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const page = await readPage(
    reader,
    { read: "community_members", args: { community: id }, source: args.source, cursor: args.cursor },
    {
      account: async (accountReader, cursor) => {
        const { data } = await accountReader.account(
          COMMUNITY_MEMBERS_OPERATION,
          { id, count: limit, cursor },
          args.account,
        )
        if (data === null) throw communityNotFound()
        return accountRowsPageOf(data, limit, accountReader.now, ACCOUNT_USER_ROWS)
      },
    },
  )
  return { method: "members", users: page.items, source: page.source, cursor: page.cursor, note: UNTRUSTED_NOTE }
}
