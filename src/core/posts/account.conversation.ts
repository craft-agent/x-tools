import { z } from "zod"
import type { Reader } from "../sources/reader"
import { accountPost } from "./account"
import { goneConversation, goneThread, type ConversationPage, type ThreadRead } from "./conversation.shape"
import type { Sort } from "./schemas"
import { POST_NOT_FOUND, assertPostId, readAtOf, unexpectedReplyError, type Post } from "./shape"

/** The bridge's `conversation` operation. */
const CONVERSATION_OPERATION = "conversation"

/** The bridge's `thread` operation. */
const THREAD_OPERATION = "thread"

/** What the bridge's `conversation` operation calls each order of replies, as its `ranking`. */
const RANKINGS: Readonly<Record<Sort, string>> = { top: "Likes", latest: "Recency" }

/** What a page of a conversation asks of the reading account. */
export type AccountConversationAsk = {
  /** The order of the replies. */
  sort: Sort
  /** The bridge's own cursor, when it continues a page. */
  cursor: string | null
  /** The reading account's label; left out, the only one. */
  account?: string
}

/** What the bridge's `conversation` operation gives: the post (as its `post` operation does, null when a continuing page leaves it out), the posts above it, a page of replies and the cursor. */
const conversationDataSchema = z.object({
  post: z.unknown(),
  ancestors: z.array(z.unknown()),
  replies: z.array(z.unknown()),
  cursor: z.string().nullish(),
})

/** What the bridge's `thread` operation gives: the author's chain, oldest first. */
const threadDataSchema = z.object({ posts: z.array(z.unknown()) })

function accountPosts(rows: unknown[], readAt: string): Post[] {
  return rows.map((row) => accountPost(row, readAt))
}

async function readAccountDetail<S extends z.ZodType>(
  reader: Reader,
  id: string,
  operation: string,
  args: Record<string, unknown>,
  account: string | undefined,
  schema: S,
): Promise<{ data: z.infer<S>; readAt: string } | null> {
  assertPostId(id)
  const { data } = await reader.account(operation, args, account)
  if (data === null) return null
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  return { data: parsed.data, readAt: readAtOf(reader.now()) }
}

/**
 * Reads one page of the conversation of post `id` through the reading account
 * `ask.account`: one paced read of the bridge's `conversation` operation. No
 * post from X (only without a cursor) is `not_found`. The posts are the
 * bridge's, each in the shape of any post, read as the reply arrives: the
 * post (null when a continuing page leaves it out), the posts it replies to,
 * root first, and the direct replies as `items`; the cursor is the next page's
 * own, null at the end. Data off the operation's shape throws `upstream_error`
 * with `details.reason` `unexpected_reply`. Throws `invalid_argument` for an
 * `id` that is not a decimal number.
 */
export async function readConversationFromAccount(
  reader: Reader,
  id: string,
  { sort, cursor, account }: AccountConversationAsk,
): Promise<ConversationPage> {
  const reply = await readAccountDetail(
    reader,
    id,
    CONVERSATION_OPERATION,
    { id, ranking: RANKINGS[sort], cursor },
    account,
    conversationDataSchema,
  )
  if (reply === null) return goneConversation(POST_NOT_FOUND)
  const { post, ancestors, replies, cursor: next } = reply.data
  return {
    status: "ok",
    reason: null,
    post: post == null ? null : accountPost(post, reply.readAt),
    ancestors: accountPosts(ancestors, reply.readAt),
    items: accountPosts(replies, reply.readAt),
    cursor: next ?? null,
  }
}

/**
 * Reads the thread of post `id` through the reading account `account`: one
 * paced read of the bridge's `thread` operation, the author's chain oldest
 * first. No post from X is `not_found`. Data off the operation's shape throws
 * `upstream_error` with `details.reason` `unexpected_reply`. Throws
 * `invalid_argument` for an `id` that is not a decimal number.
 */
export async function readThreadFromAccount(reader: Reader, id: string, account?: string): Promise<ThreadRead> {
  const reply = await readAccountDetail(reader, id, THREAD_OPERATION, { id }, account, threadDataSchema)
  if (reply === null) return goneThread(POST_NOT_FOUND)
  return { status: "ok", reason: null, posts: accountPosts(reply.data.posts, reply.readAt) }
}
