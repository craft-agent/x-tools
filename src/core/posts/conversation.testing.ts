import type { SourcesFixture } from "../sources/sources.testing"
import { fxRows } from "./list.testing"
import { fxReply, fxTombstone, fxUser } from "./posts.testing"
import type { PostReadInput } from "./schemas"
import { accountPostData } from "./view.testing"

/** Fixtures the conversation and thread tests share: the arguments of each method, FxTwitter's replies and what the reading account answers. */

/** Arguments for `conversationOfPost`. */
export const conversation = (post: string, extra: Partial<PostReadInput> = {}): PostReadInput => ({
  method: "conversation",
  post,
  ...extra,
})

/** Arguments for `threadOfPost`. */
export const thread = (post: string, extra: Partial<PostReadInput> = {}): PostReadInput => ({
  method: "thread",
  post,
  ...extra,
})

/** The path and query string FxTwitter is asked for the conversation of post `id`: `params` in the order the code writes them. */
export const conversationPath = (id: string, params: Record<string, string> = { ranking_mode: "likes" }): string =>
  `/2/conversation/${id}?${new URLSearchParams(params)}`

/** The path FxTwitter is asked for the thread of post `id`. */
export const threadPath = (id: string): string => `/2/thread/${id}`

/** The post ids of a list of posts. */
export const postIds = (posts?: { id: string }[]): string[] | undefined => posts?.map((post) => post.id)

/** What FxTwitter's `200` reply for a conversation holds: the post `id`, the chain above it, a page of replies and the `bottom` cursor. */
export function fxConversationBody(id: string, above: unknown[], replies: unknown[], bottom: string | null = null) {
  const [focal] = fxRows([id])
  return {
    ...fxReply(200, focal),
    status: focal,
    thread: [...above, focal],
    replies,
    author: fxUser(),
    cursor: bottom === null ? null : { bottom },
  }
}

/** Routes the conversation `path` to FxTwitter's `200` reply of `ids`: the chain above the post `id`, and its replies. */
export function routeConversation(
  h: SourcesFixture,
  path: string,
  id: string,
  { above = [], replies = [], bottom = null }: { above?: string[]; replies?: string[]; bottom?: string | null } = {},
): void {
  const body = fxConversationBody(id, fxRows(above), fxRows(replies), bottom)
  h.fake.route(path, { status: 200, body })
}

/** Routes the thread of post `id` to FxTwitter's `200` reply holding `rows`. */
export function routeThread(h: SourcesFixture, id: string, rows: unknown[]): void {
  h.fake.route(threadPath(id), { status: 200, body: { ...fxReply(200, rows[0]), thread: rows } })
}

/** Routes `path` to FxTwitter's `401` reply for a protected post. */
export function routeProtectedAt(h: SourcesFixture, path: string): void {
  h.fake.route(path, { status: 401, body: { code: 401, message: "PRIVATE_TWEET", status: null } })
}

/** Routes `path` to FxTwitter's `404` reply for a post gone with a tombstone of `reason`, or with none. */
export function routeGoneAt(h: SourcesFixture, path: string, reason?: string): void {
  h.fake.route(path, { status: 404, body: fxReply(404, reason === undefined ? null : fxTombstone(reason)) })
}

/** What the bridge's `conversation` operation gives: the post `id` (or none), the chain above it, its replies and the next cursor. */
export const accountConversation = (
  post: string | null,
  {
    ancestors = [],
    replies = [],
    cursor = null,
  }: { ancestors?: string[]; replies?: string[]; cursor?: string | null } = {},
) => ({
  post: post === null ? null : accountPostData(post),
  ancestors: ancestors.map((id) => accountPostData(id)),
  replies: replies.map((id) => accountPostData(id)),
  cursor,
})

/** What the bridge's `thread` operation gives: the posts of `ids`. */
export const accountThread = (ids: string[]) => ({ posts: ids.map((id) => accountPostData(id)) })
