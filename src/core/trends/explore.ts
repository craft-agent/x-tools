import { accountRowsPageOf } from "../posts/account.list"
import { checkSources } from "../posts/check-sources"
import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { ACCOUNT_TREND_ROWS, TRENDS_OPERATION } from "./account"
import { refuseForeignArguments } from "./arguments"
import { readTrendsFromFxTwitter } from "./fxtwitter"
import { TREND_CATEGORIES, UNTRUSTED_NOTE, type TrendReadInput, type TrendReadOutput } from "./schemas"

/**
 * Reads the trends of X's Explore in `args.category` (`trending` by default), a
 * page of at most `args.limit` trends (20 by default) in the source's order;
 * its `cursor` is null at the end and continues only this category on the
 * reading account. `trending` reads FxTwitter first (one page, no cursor; an
 * empty answer goes to the reading account under `auto`), the other categories
 * only the reading account, so `source: fxtwitter` is refused for them: one
 * read of the bridge's `trends` operation.
 *
 * The sources are checked before anything is read, as `listPosts` does.
 * `invalid_argument` for an argument `explore` does not take and a cursor that
 * belongs to another category.
 */
export async function exploreTrends(args: TrendReadInput, reader: Reader): Promise<TrendReadOutput> {
  refuseForeignArguments(args)
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const category = args.category ?? TREND_CATEGORIES[0]
  const page = await readPage(
    reader,
    { read: "trends", args: { category }, source: args.source, cursor: args.cursor },
    {
      fxtwitter:
        category === TREND_CATEGORIES[0]
          ? (client) => readTrendsFromFxTwitter(client, { limit, now: reader.now })
          : undefined,
      account: async (accountReader, cursor) => {
        const { data } = await accountReader.account(TRENDS_OPERATION, { category, count: limit, cursor }, args.account)
        return accountRowsPageOf(data, limit, accountReader.now, ACCOUNT_TREND_ROWS)
      },
    },
  )
  return {
    method: "explore",
    category,
    trends: page.items,
    source: page.source,
    cursor: page.cursor,
    note: UNTRUSTED_NOTE,
  }
}
