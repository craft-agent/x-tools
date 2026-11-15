import { z } from "zod"
import type { FxClient } from "../fxtwitter/client"
import type { FxOutcome } from "../sources/choose"
import { goneConversation, goneThread, type ConversationPage, type ThreadRead } from "./conversation.shape"
import { HTTP_OK, fxPost, readStatusRoute } from "./fxtwitter"
import { cursorFieldSchema, isStatusRow, nextCursor } from "./fxtwitter.list"
import type { Sort } from "./schemas"
import { assertPostId, readAtOf, unexpectedReplyError, type Post } from "./shape"

const CONVERSATION_PATH = "/2/conversation/"
const THREAD_PATH = "/2/thread/"

/** What FxTwitter calls each order of replies, in its `ranking_mode`. */
const RANKING_MODES: Readonly<Record<Sort, string>> = { top: "likes", latest: "recency" }

/** What a page of a conversation asks of FxTwitter. */
export type FxConversationAsk = {
  /** The order of the replies. */
  sort: Sort
  /** FxTwitter's own cursor, sent as `cursor` when it continues a page. */
  cursor: string | null
  /** The clock in epoch milliseconds that stamps `read_at`. */
  now: () => number
}

/** The body of a conversation: the post, the chain from the root to it, a page of replies and the cursors that continue them. */
const conversationBodySchema = z.object({
  status: z.unknown(),
  thread: z.array(z.unknown()),
  replies: z.array(z.unknown()),
  cursor: cursorFieldSchema,
})

/** The body of a thread: the author's chain, the post included. */
const threadBodySchema = z.object({ thread: z.array(z.unknown()) })

/** The posts `rows` hold as `readAt` read them: the statuses, in order; the other rows, such as tombstones, are skipped. */
function postsOf(rows: unknown[], readAt: string): Post[] {
  return rows.filter(isStatusRow).map((row) => fxPost(row, readAt))
}

/** The page a `200` body holds: the post, the posts above it (none on a continuing page), and the replies. */
function conversationPageOf(body: unknown, now: () => number): ConversationPage {
  const parsed = conversationBodySchema.safeParse(body)
  if (!parsed.success || !isStatusRow(parsed.data.status)) throw unexpectedReplyError("fxtwitter", { status: HTTP_OK })
  const { status, thread, replies, cursor } = parsed.data
  const readAt = readAtOf(now())
  const post = fxPost(status, readAt)
  return {
    status: "ok",
    reason: null,
    post,
    ancestors: postsOf(thread, readAt).filter((ancestor) => ancestor.id !== post.id),
    items: postsOf(replies, readAt),
    cursor: nextCursor(replies.length, cursor),
  }
}

/** The thread a `200` body holds. */
function threadOf(body: unknown, now: () => number): ThreadRead {
  const parsed = threadBodySchema.safeParse(body)
  if (!parsed.success) throw unexpectedReplyError("fxtwitter", { status: HTTP_OK })
  return { status: "ok", reason: null, posts: postsOf(parsed.data.thread, readAtOf(now())) }
}

/**
 * Reads one page of the conversation of post `id` from FxTwitter (`GET
 * /2/conversation/<id>` with `ranking_mode` and, when continuing, `cursor`):
 *
 * - `200`: an `answer`, the post, the posts it replies to (the root first, the
 *   post itself left out; a continuing page holds none), the page of direct
 *   replies and `cursor.bottom` as the next cursor, null when there are no
 *   replies. Tombstones among the posts are skipped.
 * - `401`: a `fallback` for the reading account, `protected`.
 * - `404`: what a single post's read says: a final `not_found` for a post
 *   that is deleted, suspended or unknown, a `fallback` for one only a
 *   signed-in reader may see.
 * - Anything else, a body off shape included: `upstream_error` with
 *   `details.reason` `unexpected_reply`.
 *
 * Every post is read at the time `ask.now` tells as the reply arrives. What
 * the client throws (a 429, a 5xx, a failed request) propagates.
 */
export async function readConversationFromFxTwitter(
  client: FxClient,
  id: string,
  { sort, cursor, now }: FxConversationAsk,
): Promise<FxOutcome<ConversationPage>> {
  assertPostId(id)
  const query = new URLSearchParams({ ranking_mode: RANKING_MODES[sort] })
  if (cursor !== null) query.set("cursor", cursor)
  return readStatusRoute(
    client,
    `${CONVERSATION_PATH}${id}?${query}`,
    (body) => conversationPageOf(body, now),
    goneConversation,
  )
}

/**
 * Reads the thread of post `id` from FxTwitter (`GET /2/thread/<id>`): the
 * author's chain, oldest first, as FxTwitter gives it whole (tombstones
 * skipped). `401` and `404` come to what `readConversationFromFxTwitter`
 * reports.
 */
export async function readThreadFromFxTwitter(
  client: FxClient,
  id: string,
  now: () => number,
): Promise<FxOutcome<ThreadRead>> {
  assertPostId(id)
  return readStatusRoute(client, `${THREAD_PATH}${id}`, (body) => threadOf(body, now), goneThread)
}
