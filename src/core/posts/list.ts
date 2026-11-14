import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { readListFromAccount, type AccountSearch } from "./account.list"
import { checkSources } from "./check-sources"
import { readListFromFxTwitter, type FxListRoute } from "./fxtwitter.list"
import {
  DEFAULT_FEED,
  UNTRUSTED_NOTE,
  type Feed,
  type PostMethod,
  type PostReadInput,
  type PostReadOutput,
} from "./schemas"

/** The methods that read nothing but a page of posts, as `readPostList` does. */
export type ListMethod = Exclude<PostMethod, "view" | "conversation" | "thread">

/** What one list method asks of the sources, once its arguments are checked. */
export type PostList = {
  method: ListMethod
  /** The arguments that decide what is read, which a cursor is bound to; never `limit`, `source`, `account` or `cursor`. */
  cursorArgs: Readonly<Record<string, unknown>>
  /** Where FxTwitter reads it. */
  fxtwitter: FxListRoute
  /** What the reading account searches for it. */
  account: AccountSearch
  /** The search query the result reports; left out for a read that is no search of words. */
  query?: string
}

/** A list backed by X's search on both sources, reporting `query` in the result. */
export function searchList(
  method: Extract<ListMethod, "search" | "mentions">,
  cursorArgs: Readonly<Record<string, unknown>>,
  query: string,
  feed: Feed = DEFAULT_FEED,
): PostList {
  return {
    method,
    cursorArgs,
    fxtwitter: { path: "/2/search", params: { q: query, feed } },
    account: { query, feed },
    query,
  }
}

/**
 * Reads one page of `list` on the source the call chose, FxTwitter first
 * under `auto`, and continues `args.cursor` on the source that gave it.
 *
 * The sources are checked before anything is read (`invalid_argument` for
 * `source: fxtwitter` under `account_only`, `not_found` for a read that needs
 * the reading account when none is set up, what a read of `args.account`
 * would be told), and a cursor that does not belong to this method, these
 * arguments and this `source` is `invalid_argument` before any request. The
 * page holds at most `args.limit` posts (20 by default) in the source's order;
 * its `cursor` is null at the end.
 */
export async function readPostList(args: PostReadInput, reader: Reader, list: PostList): Promise<PostReadOutput> {
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const page = await readPage(
    reader,
    { read: list.method, args: list.cursorArgs, source: args.source, cursor: args.cursor },
    {
      fxtwitter: (client, cursor) => readListFromFxTwitter(client, list.fxtwitter, { limit, cursor, now: reader.now }),
      account: (accountReader, cursor) =>
        readListFromAccount(accountReader, list.account, { limit, cursor, account: args.account }),
    },
  )
  return {
    method: list.method,
    results: page.items,
    source: page.source,
    cursor: page.cursor,
    ...(list.query === undefined ? {} : { query: list.query }),
    note: UNTRUSTED_NOTE,
  }
}
