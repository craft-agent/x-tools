import type { Page } from "../sources/page"
import type { Post, PostGone, PostLookup } from "./shape"

/** What a read of a post's conversation or thread says of the post itself: its lookup status, and why it is not ok (null when it is). */
type PostStanding = { status: PostLookup["status"]; reason: string | null }

/** What a page of a conversation holds beside its replies: the post, and the posts it replies to (empty beyond the first page). */
export type ConversationHead = PostStanding & { post: Post | null; ancestors: Post[] }

/** One page of a conversation: its direct replies as `items`, and the head. */
export type ConversationPage = Page<Post, ConversationHead>

/** A thread: the author's chain of posts, oldest first. */
export type ThreadRead = PostStanding & { posts: Post[] }

/** The page of a conversation whose post `gone` says is not there: nothing else to read. */
export function goneConversation(gone: PostGone): ConversationPage {
  return { status: gone.status, reason: gone.reason, post: null, ancestors: [], items: [], cursor: null }
}

/** The thread of a post `gone` says is not there: no posts. */
export function goneThread(gone: PostGone): ThreadRead {
  return { status: gone.status, reason: gone.reason, posts: [] }
}
