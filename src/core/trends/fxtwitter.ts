import { z } from "zod"
import type { FxClient } from "../fxtwitter/client"
import { HTTP_OK, readFxRoute } from "../posts/fxtwitter"
import type { FxListAsk } from "../posts/fxtwitter.list"
import { readAtOf, unexpectedReplyError } from "../posts/shape"
import type { FxOutcome } from "../sources/choose"
import type { Page } from "../sources/page"
import { TREND_CATEGORIES, type Trend } from "./schemas"
import { clipTrend, searchUrl } from "./shape"

/** FxTwitter's route for the trends of Explore. */
const TRENDS_PATH = "/2/trends"

/** What a page of trends asks of FxTwitter: it sends `count`, keeps at most that many, and takes no cursor. */
type FxTrendsAsk = Pick<FxListAsk, "limit" | "now">

/** A rank FxTwitter writes as a decimal number. */
const RANK_PATTERN = /^\d+$/

/** A v2 trend; a field FxTwitter leaves out or sends as `null` is not told. */
const fxTrendSchema = z.object({
  name: z.string(),
  rank: z.union([z.string(), z.number()]).nullish(),
  context: z.string().nullish(),
  grouped_topics: z.array(z.object({ name: z.string() })).nullish(),
})

/** The body of a `200`: its trends. */
const bodySchema = z.object({ trends: z.array(z.unknown()) })

/** The rank FxTwitter gives as an integer: a number or a decimal string; null for anything else. */
function rankOf(rank: string | number | null | undefined): number | null {
  if (typeof rank === "number") return Number.isInteger(rank) ? rank : null
  return typeof rank === "string" && RANK_PATTERN.test(rank) ? Number(rank) : null
}

/**
 * The trend a row of FxTwitter's `trends` holds, read at `readAt` (ISO 8601
 * UTC), clipped as `clipTrend` does. Its `query` is its name and its `story`
 * is null, since FxTwitter does not tell a story. A row off shape throws
 * `upstream_error` with `details.reason` `unexpected_reply`.
 */
export function trendFromFxTwitter(row: unknown, readAt: string): Trend {
  const parsed = fxTrendSchema.safeParse(row)
  if (!parsed.success) throw unexpectedReplyError("fxtwitter", { status: HTTP_OK })
  const trend = parsed.data
  return clipTrend(
    {
      name: trend.name,
      rank: rankOf(trend.rank),
      context: trend.context ?? null,
      grouped: (trend.grouped_topics ?? []).map((topic) => topic.name),
      query: trend.name,
      url: searchUrl(trend.name),
      story: null,
    },
    readAt,
  )
}

/** The page a `200` body holds: its trends, at most `limit`, read as the reply arrived; FxTwitter pages no further, so its cursor is null. */
function pageOfTrends(body: unknown, { limit, now }: FxTrendsAsk): Page<Trend> {
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) throw unexpectedReplyError("fxtwitter", { status: HTTP_OK })
  const readAt = readAtOf(now())
  return { items: parsed.data.trends.slice(0, limit).map((row) => trendFromFxTwitter(row, readAt)), cursor: null }
}

/**
 * Reads one page of the trends of `trending` of FxTwitter
 * (`GET /2/trends?type=trending&count=<limit>`; the route takes no cursor):
 *
 * - `200` with at least one trend: an `answer`, the trends, at most `ask.limit`,
 *   with no cursor.
 * - `200` with none, and `404`, FxTwitter's way to say it could not load
 *   Explore: a `fallback` for the reading account, `empty`, whose value is the
 *   empty page.
 * - Anything else, `400` and a body off shape included: `upstream_error` with
 *   `details.reason` `unexpected_reply`, since the arguments are always valid.
 *
 * What the client throws (a 429, a 5xx, a failed request) propagates.
 */
export async function readTrendsFromFxTwitter(client: FxClient, ask: FxTrendsAsk): Promise<FxOutcome<Page<Trend>>> {
  const empty: FxOutcome<Page<Trend>> = { kind: "fallback", reason: "empty", value: { items: [], cursor: null } }
  const query = new URLSearchParams({ type: TREND_CATEGORIES[0], count: String(ask.limit) })
  const outcome = await readFxRoute(client, `${TRENDS_PATH}?${query}`, {
    found: (body) => pageOfTrends(body, ask),
    notFound: () => empty,
  })
  return outcome.kind === "answer" && outcome.value.items.length === 0 ? empty : outcome
}
