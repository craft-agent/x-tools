import { z } from "zod"
import type { FxClient } from "../fxtwitter/client"
import type { FxOutcome } from "../sources/choose"
import { readFxRoute } from "./fxtwitter"
import { pageOf, pagePath, type FxListAsk, type FxListRoute } from "./fxtwitter.list"
import { POST_NOT_FOUND, type PostGone } from "./shape"
import type { Tab } from "./schemas"
import { goneTimeline, type TimelinePage } from "./timeline.shape"

/** What a tab reads of FxTwitter's v2 API, below `/2/profile/<handle>`: the path, and the query-string fields that decide it. */
const TAB_ROUTES: Readonly<Record<Tab, FxListRoute>> = {
  posts: { path: "statuses", params: {} },
  replies: { path: "statuses", params: { with_replies: "1" } },
  media: { path: "media", params: {} },
}

/** What FxTwitter says of an account it does not find: `suspended` in its `reason` for one that is. */
const notFoundBodySchema = z.object({ reason: z.string().nullish() })

/** The path of a profile route on FxTwitter's v2 API. */
export function profilePath(handle: string, suffix = ""): string {
  return `/2/profile/${encodeURIComponent(handle)}${suffix}`
}

/** The route that reads `tab` of the account `handle`. */
function timelineRoute(handle: string, tab: Tab): FxListRoute {
  const { path, params } = TAB_ROUTES[tab]
  return { path: profilePath(handle, `/${path}`), params }
}

/** What a `404` of a route of an account comes to: `not_found`, with `suspended` as its reason when FxTwitter's body says the account is. */
function missingAccountGone(body: unknown): PostGone {
  const said = notFoundBodySchema.safeParse(body)
  return said.success && said.data.reason === "suspended"
    ? { status: "not_found", reason: "suspended" }
    : POST_NOT_FOUND
}

/**
 * Reads `path` of FxTwitter as a profile-keyed route: `200` is an `answer` of
 * what `found` makes of its body; `401` is `protected` and `404` is `not_found`
 * (or `suspended`), turned into the value through `gone`; anything else, a
 * body off shape included, is `upstream_error` (`unexpected_reply`).
 */
export async function readProfileRoute<T>(
  client: FxClient,
  path: string,
  found: (body: unknown) => T,
  gone: (gone: PostGone) => T,
): Promise<FxOutcome<T>> {
  return readFxRoute(client, path, {
    found,
    unauthorized: (outcome) => ({ ...outcome, value: gone(outcome.value) }),
    notFound: (body) => ({ kind: "answer", value: gone(missingAccountGone(body)) }),
  })
}

/**
 * Reads one page of the tab `tab` of the account `handle` from FxTwitter
 * (`GET /2/profile/<handle>/statuses`, with `with_replies=1` for the `replies`
 * tab, or `/2/profile/<handle>/media`, with `count` and, when continuing,
 * `cursor`):
 *
 * - `200`: an `answer`, the rows of `type: "status"` as posts (the others are
 *   skipped), at most `ask.limit`, and `cursor.bottom` as the next cursor,
 *   null when the page has no rows.
 * - `404`: a final `not_found`, `reason` `suspended` when FxTwitter's body says
 *   so and `not_found` otherwise (a bare 404 is also how FxTwitter reports a
 *   fetch it failed).
 * - `401`: a `fallback` for the reading account, `protected`.
 * - Anything else, a body off shape included: `upstream_error` with
 *   `details.reason` `unexpected_reply`.
 *
 * Every post is read at the time `ask.now` tells as the reply arrives. What
 * the client throws (a 429, a 5xx, a failed request) propagates.
 */
export async function readTimelineFromFxTwitter(
  client: FxClient,
  handle: string,
  tab: Tab,
  ask: FxListAsk,
): Promise<FxOutcome<TimelinePage>> {
  return readProfileRoute(
    client,
    pagePath(timelineRoute(handle, tab), ask),
    (body) => ({ status: "ok", reason: null, ...pageOf(body, ask) }),
    goneTimeline,
  )
}
