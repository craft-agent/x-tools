import type { ReaderOverrides } from "../sources/reader"
import type { SourcesFixture } from "../sources/sources.testing"
import type { ToolOptions } from "../tool"
import { accountData, fxReply, fxStatus, fxTombstone, fxUser } from "./posts.testing"
import type { PostReadInput } from "./schemas"

/** Fixtures the `view` tests share: routes of the fake FxTwitter by post id, and a reader whose reading account answers by post id. */

/** Arguments for `viewPosts`: `method` is `"view"` and `extra` sets any other field. */
export function view(posts: string[], extra: Partial<PostReadInput> = {}): PostReadInput {
  return { method: "view", posts, ...extra }
}

/** The path FxTwitter is asked for a post. */
export const statusPath = (id: string): string => `/2/status/${id}`

/** Routes `id` to a post by `handle`; `fields` replace any field of the status. */
export function routePost(h: SourcesFixture, id: string, handle = "ada_writes", fields: Record<string, unknown> = {}) {
  h.fake.route(statusPath(id), { status: 200, body: fxReply(200, fxStatus({ id, author: fxUser(handle), ...fields })) })
}

/** Routes `id` to a post FxTwitter reports gone with a tombstone of `reason`. */
export function routeGone(h: SourcesFixture, id: string, reason: string): void {
  h.fake.route(statusPath(id), { status: 404, body: fxReply(404, fxTombstone(reason)) })
}

/** Routes `id` to FxTwitter's `401` reply for a protected post. */
export function routeProtected(h: SourcesFixture, id: string): void {
  h.fake.route(statusPath(id), { status: 401, body: { code: 401, message: "PRIVATE_TWEET", status: null } })
}

/** The paths the fake FxTwitter was asked for, in order. */
export const requested = (h: SourcesFixture): string[] => h.fake.requests.map((request) => request.path)

/** The post of the bridge's `post` operation for `id`, by `handle`. */
export const accountPostData = (id: string, handle = "ada_writes") =>
  accountData({ id, user: { id: "4001", username: handle, displayname: "Ada Writes" } })

/**
 * A reader whose reading account answers a read of post `id` with `answers[id]`
 * (`null` for a post X does not give); each read is recorded in `h.accountReads`.
 */
export function readerAnswering(
  h: SourcesFixture,
  answers: Record<string, unknown>,
  options?: ToolOptions,
  overrides: ReaderOverrides = {},
) {
  return h.reader(options, {
    readAccount: async (readOptions) => {
      h.accountReads.push(readOptions)
      return { account: readOptions.account ?? "default", data: answers[String(readOptions.args?.id)] }
    },
    ...overrides,
  })
}
