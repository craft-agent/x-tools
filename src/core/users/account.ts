import { z } from "zod"
import { accountRowsPageOf, type AccountListAsk, type AccountRows } from "../posts/account.list"
import { USER_OPERATION } from "../posts/account.timeline"
import { POST_NOT_FOUND, isoUtc, nullishNumber, readAtOf, unexpectedReplyError } from "../posts/shape"
import type { Page } from "../sources/page"
import type { Reader } from "../sources/reader"
import { USER_ID_PATTERN } from "../x/user-ids"
import { clipUser, locationOf, lowercaseOrNull, userUrl, type User, type UserLookup } from "./shape"

/** The bridge's `user_search` operation. */
const USER_SEARCH_OPERATION = "user_search"

/** What the bridge's `user` operation gives for an account: the same dict in a page of `user_search`. */
const accountUserSchema = z.object({
  id: z.string().regex(USER_ID_PATTERN),
  username: z.string(),
  displayname: z.string(),
  description: z.string().nullish(),
  location: z.string().nullish(),
  created: z.string().nullish(),
  followers: nullishNumber,
  following: nullishNumber,
  posts: nullishNumber,
  media: nullishNumber,
  likes: nullishNumber,
  protected: z.boolean().nullish(),
  verified: z.boolean().nullish(),
  blue: z.boolean().nullish(),
  blue_type: z.string().nullish(),
  links: z.array(z.string()).nullish(),
  avatar: z.string().nullish(),
  banner: z.string().nullish(),
})

/** Whether the account has any checkmark, the legacy one or X's paid one: null when the bridge tells neither. */
function verifiedOf(verified: boolean | null | undefined, blue: boolean | null | undefined): boolean | null {
  if (verified == null && blue == null) return null
  return verified === true || blue === true
}

/**
 * The profile the bridge's `user` operation gave, read at `readAt` (ISO 8601
 * UTC), in the same shape and clipping as FxTwitter's: `verified` is any
 * checkmark, the legacy one or X's paid one, whose kind is `verified_type`.
 * Data off the operation's shape throws `upstream_error` with
 * `details.reason` `unexpected_reply`.
 */
export function userFromAccount(data: unknown, readAt: string): User {
  const parsed = accountUserSchema.safeParse(data)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  const user = parsed.data
  return clipUser({
    id: user.id,
    handle: user.username,
    name: user.displayname,
    url: userUrl(user.username),
    bio: user.description ?? "",
    links: user.links ?? [],
    location: locationOf(user.location),
    joined: user.created ? isoUtc(Date.parse(user.created)) : null,
    counts: {
      followers: user.followers ?? null,
      following: user.following ?? null,
      posts: user.posts ?? null,
      likes: user.likes ?? null,
      media: user.media ?? null,
    },
    protected: user.protected ?? null,
    verified: verifiedOf(user.verified, user.blue),
    verified_type: lowercaseOrNull(user.blue_type),
    avatar_url: user.avatar ?? null,
    banner_url: user.banner ?? null,
    read_at: readAt,
  })
}

/** The rows of a page of users: the bridge's `users`, each as its `user` operation gives an account. */
const ACCOUNT_USER_ROWS: AccountRows<User> = { key: "users", read: userFromAccount }

/**
 * Reads the profile of the account `handle` through the reading account
 * `account` (the only one when left out): one paced read of the bridge's
 * `user` operation. No user from X is `not_found`, since the reading account
 * cannot tell an account that is gone from one it may not see. The account's
 * user id is remembered for `handle`, so a later `timeline` through the same
 * label takes one read. The profile's `read_at` is the time the reader's clock
 * tells as the bridge answers.
 */
export async function readUserFromAccount(
  reader: Reader,
  handle: string,
  account: string | undefined,
): Promise<UserLookup> {
  const { data } = await reader.account(USER_OPERATION, { handle }, account)
  if (data === null) return POST_NOT_FOUND
  const user = userFromAccount(data, readAtOf(reader.now()))
  await reader.rememberUserId(handle, user.id, account)
  return { status: "ok", user }
}

/**
 * Reads one page of the search of users for `query` through the reading
 * account: one paced read of the bridge's `user_search` operation, with `count`
 * the call's `limit`. The users are the bridge's, in its order, at most
 * `ask.limit`, read as the reply arrives; its cursor is the next page's own,
 * null at the end. Data off the operation's shape throws `upstream_error` with
 * `details.reason` `unexpected_reply`; what the read throws, such as
 * `forbidden` for a search X refuses an account whose phone is not verified,
 * propagates.
 */
export async function readUsersFromAccount(
  reader: Reader,
  query: string,
  { limit, cursor, account }: AccountListAsk,
): Promise<Page<User>> {
  const { data } = await reader.account(USER_SEARCH_OPERATION, { query, count: limit, cursor }, account)
  return accountRowsPageOf(data, limit, reader.now, ACCOUNT_USER_ROWS)
}
