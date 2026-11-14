import { z } from "zod"
import type { Page } from "../sources/page"
import type { Reader } from "../sources/reader"
import { accountPost } from "./account"
import type { Feed } from "./schemas"
import { readAtOf, unexpectedReplyError, type Post } from "./shape"

/** The bridge's `search` operation. */
const SEARCH_OPERATION = "search"

/** What the bridge's `search` operation reads, for each feed. */
const PRODUCTS: Readonly<Record<Feed, string>> = { latest: "Latest", top: "Top", media: "Media" }

/** What the reading account searches: X's query, and the feed of the results. */
export type AccountSearch = { query: string; feed: Feed }

/** What a page of a search asks of the reading account. */
export type AccountListAsk = {
  /** Sent as `count`, and the most posts the page keeps. */
  limit: number
  /** The bridge's own cursor, when it continues a page. */
  cursor: string | null
  /** The reading account's label; left out, the only one. */
  account?: string
}

/** What the bridge's `search` operation gives: the posts as its `post` operation does, and the cursor of the next page. */
const searchDataSchema = z.object({ posts: z.array(z.unknown()), cursor: z.string().nullish() })

/**
 * Reads one page of a search through the reading account: one paced read of
 * the bridge's `search` operation, with `count` the call's `limit`. The posts
 * are the bridge's, in its order, at most `limit`, each in the shape of any
 * post (a community note `unknown`), read as the reply arrives; its cursor is
 * the next page's own, null at the end. Data off the operation's shape throws
 * `upstream_error` with `details.reason` `unexpected_reply`; what the read
 * throws, such as `forbidden` for a search X refuses an account whose phone is
 * not verified, propagates.
 */
export async function readListFromAccount(
  reader: Reader,
  { query, feed }: AccountSearch,
  { limit, cursor, account }: AccountListAsk,
): Promise<Page<Post>> {
  const { data } = await reader.account(
    SEARCH_OPERATION,
    { query, product: PRODUCTS[feed], count: limit, cursor },
    account,
  )
  const parsed = searchDataSchema.safeParse(data)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  const readAt = readAtOf(reader.now())
  return {
    items: parsed.data.posts.slice(0, limit).map((row) => accountPost(row, readAt)),
    cursor: parsed.data.cursor ?? null,
  }
}
