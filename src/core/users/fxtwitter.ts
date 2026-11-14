import { z } from "zod"
import type { FxClient } from "../fxtwitter/client"
import { HTTP_OK } from "../posts/fxtwitter"
import { isRowOfType, readRowsFromFxTwitter, type FxListAsk, type FxRows } from "../posts/fxtwitter.list"
import { profilePath, readProfileRoute } from "../posts/fxtwitter.timeline"
import { nullishNumber, readAtOf, unexpectedReplyError } from "../posts/shape"
import type { FxOutcome } from "../sources/choose"
import type { Page } from "../sources/page"
import { parseJoined } from "./joined"
import { clipUser, locationOf, lowercaseOrNull, userUrl, type User, type UserLookup } from "./shape"

const SEARCH_PATH = "/2/search/users"

/** The `type` of a row that is a profile. */
const PROFILE_TYPE = "profile"

/** A facet of a bio: only a link's expanded address is read. */
const facetSchema = z.object({ type: z.string(), replacement: z.string().nullish() })

/** A v2 `APIUser` as a profile page and a search of users carry it; a field FxTwitter leaves out or sends as `null` is not told. */
const profileSchema = z.object({
  type: z.literal(PROFILE_TYPE),
  id: z.string(),
  screen_name: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  raw_description: z.object({ facets: z.array(facetSchema).nullish() }).nullish(),
  location: z.string().nullish(),
  joined: z.string().nullish(),
  followers: nullishNumber,
  following: nullishNumber,
  statuses: nullishNumber,
  likes: nullishNumber,
  media_count: nullishNumber,
  protected: z.boolean().nullish(),
  website: z.object({ url: z.string().nullish() }).nullish(),
  verification: z.object({ verified: z.boolean().nullish(), type: z.string().nullish() }).nullish(),
  avatar_url: z.string().nullish(),
  banner_url: z.string().nullish(),
})

type FxProfile = z.infer<typeof profileSchema>

/** The addresses of a profile: its website, then the expanded address of each link of its bio, each once and in order. */
function linksOf({ website, raw_description: description }: FxProfile): string[] {
  const links = [
    website?.url,
    ...(description?.facets ?? []).map((facet) => (facet.type === "url" ? facet.replacement : undefined)),
  ]
  return [...new Set(links.filter((link): link is string => typeof link === "string" && link !== ""))]
}

/**
 * The profile a v2 `APIUser` (`type: "profile"`) holds, read at `readAt` (ISO
 * 8601 UTC): the same shape whichever source answered, clipped, with a field
 * FxTwitter leaves out null. Its links are its website then the expanded
 * address of each link of its bio; its `joined` is null when X's form of it
 * does not parse. A row that is off shape throws `upstream_error` with
 * `details.reason` `unexpected_reply`.
 */
export function userFromFxTwitter(row: unknown, readAt: string): User {
  const parsed = profileSchema.safeParse(row)
  if (!parsed.success) throw unexpectedReplyError("fxtwitter", { status: HTTP_OK })
  const profile = parsed.data
  return clipUser({
    id: profile.id,
    handle: profile.screen_name,
    name: profile.name,
    url: userUrl(profile.screen_name),
    bio: profile.description ?? "",
    links: linksOf(profile),
    location: locationOf(profile.location),
    joined: profile.joined ? parseJoined(profile.joined) : null,
    counts: {
      followers: profile.followers ?? null,
      following: profile.following ?? null,
      posts: profile.statuses ?? null,
      likes: profile.likes ?? null,
      media: profile.media_count ?? null,
    },
    protected: profile.protected ?? null,
    verified: profile.verification?.verified ?? null,
    verified_type: lowercaseOrNull(profile.verification?.type),
    avatar_url: profile.avatar_url ?? null,
    banner_url: profile.banner_url ?? null,
    read_at: readAt,
  })
}

/** The rows of a list of users: its profiles. */
const FX_USER_ROWS: FxRows<User> = {
  isItem: (row) => isRowOfType(row, PROFILE_TYPE),
  read: userFromFxTwitter,
}

/** The `user` field of a reply's body; throws `unexpected_reply` for a body that is not an object holding one. */
function userField(body: unknown): unknown {
  if (typeof body !== "object" || body === null || !("user" in body)) {
    throw unexpectedReplyError("fxtwitter", { status: HTTP_OK })
  }
  return body.user
}

/**
 * Reads the profile of the account `handle` of FxTwitter
 * (`GET /2/profile/<handle>`) as the choice between the sources needs it:
 *
 * - `200` with a profile: an `answer`, the user.
 * - `404`: a final `not_found`, `reason` `suspended` when FxTwitter's body says
 *   so and `not_found` otherwise.
 * - `401`: a `fallback` for the reading account, `protected`.
 * - Anything else, a body off shape included: `upstream_error` with
 *   `details.reason` `unexpected_reply`.
 *
 * The profile's `read_at` is the time `now` tells as the reply arrives. What
 * the client throws (a 429, a 5xx, a failed request) propagates.
 */
export async function readUserFromFxTwitter(
  client: FxClient,
  handle: string,
  now: () => number,
): Promise<FxOutcome<UserLookup>> {
  return readProfileRoute<UserLookup>(
    client,
    profilePath(handle),
    (body) => ({ status: "ok", user: userFromFxTwitter(userField(body), readAtOf(now())) }),
    (gone) => gone,
  )
}

/**
 * Reads one page of the search of users for `query` of FxTwitter
 * (`GET /2/search/users?q=<query>`, with `count` and, when continuing,
 * `cursor`): the rows of `type: "profile"` as users, at most `ask.limit`; a
 * page as `readRowsFromFxTwitter` reads it.
 */
export async function readUsersFromFxTwitter(
  client: FxClient,
  query: string,
  ask: FxListAsk,
): Promise<FxOutcome<Page<User>>> {
  return readRowsFromFxTwitter(client, { path: SEARCH_PATH, params: { q: query } }, ask, FX_USER_ROWS)
}
