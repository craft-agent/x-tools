import { z } from "zod"
import type { FxClient } from "../fxtwitter/client"
import type { FxOutcome } from "../sources/choose"
import { readFxRoute } from "./fxtwitter"
import { pageOf, pagePath, type FxListAsk, type FxListRoute } from "./fxtwitter.list"
import { POST_NOT_FOUND } from "./shape"
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

/** The route that reads `tab` of the account `handle`. */
function timelineRoute(handle: string, tab: Tab): FxListRoute {
  const { path, params } = TAB_ROUTES[tab]
  return { path: `/2/profile/${encodeURIComponent(handle)}/${path}`, params }
}

/** What a `404` came to: `not_found`, final, with `suspended` as its reason when FxTwitter says the account is. */
function notFoundOutcome(body: unknown): FxOutcome<TimelinePage> {
  const said = notFoundBodySchema.safeParse(body)
  const suspended = said.success && said.data.reason === "suspended"
  return {
    kind: "answer",
    value: goneTimeline(suspended ? { status: "not_found", reason: "suspended" } : POST_NOT_FOUND),
  }
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
  return readFxRoute(client, pagePath(timelineRoute(handle, tab), ask), {
    found: (body) => ({ status: "ok", reason: null, ...pageOf(body, ask) }),
    unauthorized: (outcome) => ({ ...outcome, value: goneTimeline(outcome.value) }),
    notFound: notFoundOutcome,
  })
}
