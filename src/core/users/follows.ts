import type { FxClient } from "../fxtwitter/client"
import { accountRowsPageOf, type AccountListAsk } from "../posts/account.list"
import { resolveUserId } from "../posts/account.timeline"
import { checkSources } from "../posts/check-sources"
import type { PostStanding } from "../posts/conversation.shape"
import { pageOfRows, pagePath, type FxListAsk } from "../posts/fxtwitter.list"
import { profilePath, readProfileRoute } from "../posts/fxtwitter.timeline"
import { parseHandle } from "../posts/handle"
import { POST_NOT_FOUND, type PostGone } from "../posts/shape"
import type { FxOutcome } from "../sources/choose"
import { DEFAULT_LIMIT, readPage, type Page } from "../sources/page"
import type { Reader } from "../sources/reader"
import { ACCOUNT_USER_ROWS } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { FX_USER_ROWS } from "./fxtwitter"
import { UNTRUSTED_NOTE, type UserMethod, type UserReadInput, type UserReadOutput } from "./schemas"
import type { User } from "./shape"

/** The bridge's `follows` operation. */
const FOLLOWS_OPERATION = "follows"

/** The methods that read the accounts that follow an account, or that it follows. */
export type FollowDirection = Extract<UserMethod, "followers" | "following">

/** One page of an account's followers or following: its users as `items`, and what the account came to. */
type FollowsPage = Page<User, PostStanding>

/** The page of an account whose followers `gone` says are not there or not shown: nothing else to read. */
function goneFollows(gone: PostGone): FollowsPage {
  return { status: gone.status, reason: gone.reason, items: [], cursor: null }
}

/**
 * Reads one page of the accounts in `direction` of the account `handle` from
 * FxTwitter (`GET /2/profile/<handle>/followers` or `/following`, with `count`
 * and, when continuing, `cursor`):
 *
 * - `200`: an `answer`, the rows of `type: "profile"` as users (the others are
 *   skipped), at most `ask.limit`, and `cursor.bottom` as the next cursor,
 *   null when the page has no rows.
 * - `404`: a final `not_found`, `reason` `suspended` when FxTwitter's body says
 *   so and `not_found` otherwise.
 * - `401`: a `fallback` for the reading account, `protected`.
 * - Anything else, a body off shape included: `upstream_error` with
 *   `details.reason` `unexpected_reply`.
 */
async function readFollowsFromFxTwitter(
  client: FxClient,
  handle: string,
  direction: FollowDirection,
  ask: FxListAsk,
): Promise<FxOutcome<FollowsPage>> {
  return readProfileRoute<FollowsPage>(
    client,
    pagePath({ path: profilePath(handle, `/${direction}`), params: {} }, ask),
    (body) => ({ status: "ok", reason: null, ...pageOfRows(body, ask, FX_USER_ROWS) }),
    goneFollows,
  )
}

/**
 * Reads one page of the accounts in `direction` of the account `handle`
 * through the reading account `ask.account`: one paced read of the bridge's
 * `follows` operation with `count` the call's `limit`, after one of its `user`
 * operation when the account does not remember the handle's user id
 * (`Reader.userId`), so a first read takes two reads and the next ones take
 * one. No user from X is `not_found`, with no `follows` read. The users are the
 * bridge's, in its order, at most `ask.limit`; the cursor is the next page's
 * own, null at the end. Data off an operation's shape throws `upstream_error`
 * with `details.reason` `unexpected_reply`.
 */
async function readFollowsFromAccount(
  reader: Reader,
  handle: string,
  direction: FollowDirection,
  { limit, cursor, account }: AccountListAsk,
): Promise<FollowsPage> {
  const userId = await resolveUserId(reader, handle, account)
  if (userId === null) return goneFollows(POST_NOT_FOUND)
  const { data } = await reader.account(
    FOLLOWS_OPERATION,
    { user_id: userId, direction, count: limit, cursor },
    account,
  )
  return { status: "ok", reason: null, ...accountRowsPageOf(data, limit, reader.now, ACCOUNT_USER_ROWS) }
}

/**
 * The handler of `followers` or `following`, by `direction`: a page of the
 * accounts that follow the account `args.handle` (with or without `@`, read in
 * lower case), or that it follows, at most `args.limit` users (20 by default)
 * in the source's order. Its `cursor` is null at the end and continues only
 * this direction and handle on the source that gave it.
 *
 * The sources are checked before anything is read, as `timelineOfAccount`
 * does. An account that is not there, or that no source may show, comes back
 * with its `status` and `reason`, no users and no cursor. `invalid_argument`
 * for an argument the method does not take, a missing or malformed handle, and
 * a cursor that belongs to another read or handle, the other direction's
 * included.
 */
export function readFollows(direction: FollowDirection) {
  return async (args: UserReadInput, reader: Reader): Promise<UserReadOutput> => {
    refuseForeignArguments(args)
    const handle = parseHandle(requireArgument(args, "handle"), "handle").toLowerCase()
    await checkSources(args, reader)
    const limit = args.limit ?? DEFAULT_LIMIT
    const page = await readPage(
      reader,
      { read: direction, args: { handle }, source: args.source, cursor: args.cursor },
      {
        fxtwitter: (client, cursor) =>
          readFollowsFromFxTwitter(client, handle, direction, { limit, cursor, now: reader.now }),
        account: (accountReader, cursor) =>
          readFollowsFromAccount(accountReader, handle, direction, { limit, cursor, account: args.account }),
      },
    )
    return {
      method: direction,
      status: page.status,
      reason: page.reason,
      results: page.items,
      source: page.source,
      cursor: page.cursor,
      note: UNTRUSTED_NOTE,
    }
  }
}
