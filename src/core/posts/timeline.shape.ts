import type { Page } from "../sources/page"
import type { PostStanding } from "./conversation.shape"
import type { Post, PostGone } from "./shape"

/** One page of an account's timeline: its posts as `items`, and what the account came to. */
export type TimelinePage = Page<Post, PostStanding>

/** The page of a timeline whose account `gone` says is not there or not shown: nothing else to read. */
export function goneTimeline(gone: PostGone): TimelinePage {
  return { status: gone.status, reason: gone.reason, items: [], cursor: null }
}
