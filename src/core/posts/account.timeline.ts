import { z } from "zod"
import type { Reader } from "../sources/reader"
import { USER_ID_PATTERN } from "../x/user-ids"
import { accountPageOf, type AccountListAsk } from "./account.list"
import type { Tab } from "./schemas"
import { POST_NOT_FOUND, unexpectedReplyError } from "./shape"
import { goneTimeline, type TimelinePage } from "./timeline.shape"

/** The bridge's `user` operation. */
export const USER_OPERATION = "user"

/** The bridge's `timeline` operation. */
const TIMELINE_OPERATION = "timeline"

/** What the bridge's `user` operation gives for an account: its user id, beside the fields other reads use. */
const userDataSchema = z.object({ id: z.string().regex(USER_ID_PATTERN) })

/** The user id of `handle` for the reading account `account`: the one it remembers, else one read of X, which it then remembers; null when X shows no such account. */
export async function resolveUserId(
  reader: Reader,
  handle: string,
  account: string | undefined,
): Promise<string | null> {
  const remembered = await reader.userId(handle, account)
  if (remembered !== null) return remembered
  const { data } = await reader.account(USER_OPERATION, { handle }, account)
  if (data === null) return null
  const parsed = userDataSchema.safeParse(data)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  await reader.rememberUserId(handle, parsed.data.id, account)
  return parsed.data.id
}

/**
 * Reads one page of the tab `tab` of the account `handle` through the reading
 * account `ask.account`: one paced read of the bridge's `timeline` operation
 * with `count` the call's `limit`, after one of its `user` operation when the
 * account does not remember the handle's user id (`Reader.userId`), so a first
 * read takes two reads and the next ones take one. No user from X is
 * `not_found`, with no `timeline` read. The posts are the bridge's, in its
 * order, at most `ask.limit`, each in the shape of any post (a community note
 * `unknown`), read as the reply arrives; the cursor is the next page's own,
 * null at the end. Data off an operation's shape throws `upstream_error` with
 * `details.reason` `unexpected_reply`.
 */
export async function readTimelineFromAccount(
  reader: Reader,
  handle: string,
  tab: Tab,
  { limit, cursor, account }: AccountListAsk,
): Promise<TimelinePage> {
  const userId = await resolveUserId(reader, handle, account)
  if (userId === null) return goneTimeline(POST_NOT_FOUND)
  const { data } = await reader.account(TIMELINE_OPERATION, { user_id: userId, tab, count: limit, cursor }, account)
  return { status: "ok", reason: null, ...accountPageOf(data, limit, reader.now) }
}
