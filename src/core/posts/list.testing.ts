import { encodeCursor } from "../sources/cursor"
import { DEFAULT_LIMIT } from "../sources/page"
import type { ReaderOverrides } from "../sources/reader"
import type { SourcesFixture } from "../sources/sources.testing"
import type { ToolOptions } from "../tool"
import type { Answerer } from "../sources/source"
import { fxStatus, fxUser } from "./posts.testing"
import type { PostMethod, PostReadInput } from "./schemas"
import { accountPostData, statusPath } from "./view.testing"

/** Fixtures the list tests share (search, quotes, mentions): the arguments of each method, FxTwitter's list replies and a reading account that answers a page. */

/** Arguments for `searchPosts`. */
export const search = (query: string, extra: Partial<PostReadInput> = {}): PostReadInput => ({
  method: "search",
  query,
  ...extra,
})

/** Arguments for `quotesOfPost`. */
export const quotes = (post: string, extra: Partial<PostReadInput> = {}): PostReadInput => ({
  method: "quotes",
  post,
  ...extra,
})

/** Arguments for `mentionsOfAccount`. */
export const mentions = (handle: string, extra: Partial<PostReadInput> = {}): PostReadInput => ({
  method: "mentions",
  handle,
  ...extra,
})

/** The path and query string FxTwitter is asked for a search: `params` in the order the code writes them. */
export const searchPath = (params: Record<string, string>): string => `/2/search?${new URLSearchParams(params)}`

/** The path and query string FxTwitter is asked for the quotes of post `id`. */
export const quotesPath = (id: string, params: Record<string, string> = { count: String(DEFAULT_LIMIT) }): string =>
  `${statusPath(id)}/quotes?${new URLSearchParams(params)}`

/** The statuses of `ids`, by `handle`, as a list carries them. */
export const fxRows = (ids: string[], handle = "ada_writes"): unknown[] =>
  ids.map((id) => fxStatus({ id, author: fxUser(handle) }))

/** FxTwitter's `200` reply for a list: `rows` and the `bottom` cursor (`top` is always there). */
export function fxListReply(rows: unknown[], bottom: string | null = null) {
  return { status: 200, body: { code: 200, message: "OK", results: rows, cursor: { top: "TOP", bottom } } }
}

/** Routes `path` to a list of `rows` whose next cursor is `bottom`. */
export function routeList(h: SourcesFixture, path: string, rows: unknown[], bottom: string | null = null): void {
  h.fake.route(path, fxListReply(rows, bottom))
}

/** What the bridge's `search` operation gives: the posts of `ids`, and the cursor of the next page. */
export const accountPage = (ids: string[], cursor: string | null = null) => ({
  posts: ids.map((id) => accountPostData(id)),
  cursor,
})

/** The cursor a call gets for `own` from `source`, for `method` and the `args` that decide what it reads. */
export const cursorOf = (source: Answerer, method: PostMethod, args: Record<string, unknown>, own: string): string =>
  encodeCursor({ source, read: method, args, cursor: own })

/** A reader whose reading account answers every read with `data`; each read is recorded in `h.accountReads`. */
export function readerPaging(h: SourcesFixture, data: unknown, options?: ToolOptions, overrides: ReaderOverrides = {}) {
  return h.reader(options, {
    readAccount: async (readOptions) => {
      h.accountReads.push(readOptions)
      return { account: readOptions.account ?? "default", data }
    },
    ...overrides,
  })
}
