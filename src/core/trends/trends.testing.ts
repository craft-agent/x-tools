import { encodeCursor } from "../sources/cursor"
import { DEFAULT_LIMIT } from "../sources/page"
import type { SourcesFixture } from "../sources/sources.testing"
import type { Answerer } from "../sources/source"
import type { TrendReadInput } from "./schemas"

/** Fixtures the trend tests share: the arguments of `explore`, FxTwitter's trends reply and the bridge's data. */

/** Arguments for `exploreTrends`. */
export const explore = (extra: Partial<TrendReadInput> = {}): TrendReadInput => ({ method: "explore", ...extra })

/** The path and query string FxTwitter is asked for the trends, `count` of them. */
export const trendsPath = (count = DEFAULT_LIMIT): string => `/2/trends?type=trending&count=${count}`

/** A trend as FxTwitter's `/2/trends` carries it; `extra` replaces fields. */
export const fxTrend = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  rank: null,
  context: "Sports · Trending",
  ...extra,
})

/** FxTwitter's `200` reply for the trends: `trends`, and the `cursor` the route sends though it takes none. */
export const fxTrendsReply = (trends: unknown[]) => ({
  status: 200,
  body: { code: 200, message: null, timeline_type: "trending", trends, cursor: { top: "TOP", bottom: "BOTTOM" } },
})

/** Routes the trends path for `count` to `trends`. */
export function routeTrends(h: SourcesFixture, trends: unknown[], count?: number): void {
  h.fake.route(trendsPath(count), fxTrendsReply(trends))
}

/** A trend as the bridge's `trends` operation gives it; `extra` replaces fields. */
export const accountTrend = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  rank: 1,
  context: null,
  grouped: [],
  query: null,
  story_id: null,
  ...extra,
})

/** What the bridge's `trends` operation gives: `trends`, and the cursor of the next page. */
export const accountTrendsPage = (trends: unknown[], cursor: string | null = null) => ({ trends, cursor })

/** The cursor a call gets for `own` from `source`, for the `args` that decide what it reads. */
export const cursorOf = (source: Answerer, args: Record<string, unknown>, own: string): string =>
  encodeCursor({ source, read: "trends", args, cursor: own })
