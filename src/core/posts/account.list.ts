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

/** What the bridge's operations that page rows give besides the rows, which each operation keeps under a key of its own: the cursor of the next page. */
const pageDataSchema = z.looseObject({ cursor: z.string().nullish() })

/** The rows of a page of the bridge's data. */
const rowsSchema = z.array(z.unknown())

/** What a page of the bridge's data holds: the key its rows are under, and what an item is made of a row, read at `readAt`. */
export type AccountRows<T> = {
  key: string
  read: (row: unknown, readAt: string) => T
}

/** The rows of a page of posts: the bridge's `posts`, each as its `post` operation gives a post. */
const POST_ROWS: AccountRows<Post> = { key: "posts", read: accountPost }

/**
 * The page the bridge's data `data` holds: the items of its rows under
 * `rows.key`, at most `limit`, read at the time `now` tells; its cursor is the
 * next page's own, null at the end. Data off the operations' shape throws
 * `upstream_error` with `details.reason` `unexpected_reply`.
 */
export function accountRowsPageOf<T>(data: unknown, limit: number, now: () => number, rows: AccountRows<T>): Page<T> {
  const parsed = pageDataSchema.safeParse(data)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  const held = rowsSchema.safeParse(parsed.data[rows.key])
  if (!held.success) throw unexpectedReplyError("account", { cause: held.error })
  const readAt = readAtOf(now())
  return {
    items: held.data.slice(0, limit).map((row) => rows.read(row, readAt)),
    cursor: parsed.data.cursor ?? null,
  }
}

/**
 * The page the bridge's data `data` holds: its posts, at most `limit`, each in
 * the shape of any post, read at the time `now` tells; its cursor is the next
 * page's own, null at the end. Data off the operations' shape throws
 * `upstream_error` with `details.reason` `unexpected_reply`.
 */
export function accountPageOf(data: unknown, limit: number, now: () => number): Page<Post> {
  return accountRowsPageOf(data, limit, now, POST_ROWS)
}

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
  return accountPageOf(data, limit, reader.now)
}
