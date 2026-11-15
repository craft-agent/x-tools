import { accountPageOf } from "../posts/account.list"
import { checkSources } from "../posts/check-sources"
import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { COMMUNITY_POSTS_OPERATION, communityNotFound } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { parseCommunityRef } from "./refs"
import { COMMUNITY_ORDERS, UNTRUSTED_NOTE, type CommunityReadInput, type CommunityReadOutput } from "./schemas"

/** The ranking the bridge's `community_posts` operation is asked for, per order. */
const RANKINGS = { relevance: "Relevance", recency: "Recency" } as const

/**
 * Reads the posts of the community `args.community` names (an id or a URL) in
 * `args.order` (`relevance` by default), a page of at most `args.limit` posts
 * (20 by default) in X's order, each in the shape of any post (a community
 * note `unknown`); its `cursor` is null at the end and continues only this
 * community, in this order, on the reading account. FxTwitter has no
 * community route, so `source: fxtwitter` is refused and `auto` reads the
 * account: one read of the bridge's `community_posts` operation.
 *
 * The sources are checked before anything is read, as `listPosts` does.
 * `invalid_argument` for an argument `posts` does not take, a missing or
 * malformed community, and a cursor that belongs to another read, community
 * or order; `not_found` for a community X gives no data for.
 */
export async function communityPosts(args: CommunityReadInput, reader: Reader): Promise<CommunityReadOutput> {
  refuseForeignArguments(args)
  const id = parseCommunityRef(requireArgument(args, "community"), "community")
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const order = args.order ?? COMMUNITY_ORDERS[0]
  const page = await readPage(
    reader,
    { read: "community_posts", args: { community: id, order }, source: args.source, cursor: args.cursor },
    {
      account: async (accountReader, cursor) => {
        const { data } = await accountReader.account(
          COMMUNITY_POSTS_OPERATION,
          { id, ranking: RANKINGS[order], count: limit, cursor },
          args.account,
        )
        if (data === null) throw communityNotFound()
        return accountPageOf(data, limit, accountReader.now)
      },
    },
  )
  return { method: "posts", posts: page.items, source: page.source, cursor: page.cursor, note: UNTRUSTED_NOTE }
}
