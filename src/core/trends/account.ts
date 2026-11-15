import { z } from "zod"
import type { AccountRows } from "../posts/account.list"
import { nullishNumber, unexpectedReplyError } from "../posts/shape"
import type { Trend } from "./schemas"
import { clipTrend, searchUrl } from "./shape"

/** The bridge's `trends` operation. */
export const TRENDS_OPERATION = "trends"

/** The page of the story `id` on x.com. */
const storyUrl = (id: string): string => `https://x.com/i/trending/${id}`

/** What the bridge's `trends` operation gives for a trend. */
const accountTrendSchema = z.object({
  name: z.string(),
  rank: nullishNumber,
  context: z.string().nullish(),
  grouped: z.array(z.string()),
  query: z.string().nullish(),
  story_id: z.string().nullish(),
})

/**
 * The trend the bridge's `trends` operation gave in `row`, read at `readAt`
 * (ISO 8601 UTC), clipped as `clipTrend` does. Its `query` is X's own, else
 * its name; a story (it has a `story_id`) has none unless X gives one, and its
 * `url` is the story's page. Data off the operation's shape throws
 * `upstream_error` with `details.reason` `unexpected_reply`.
 */
export function trendFromAccount(row: unknown, readAt: string): Trend {
  const parsed = accountTrendSchema.safeParse(row)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  const trend = parsed.data
  const storyId = trend.story_id ?? null
  const query = trend.query ?? (storyId ? null : trend.name)
  const url = storyId ? storyUrl(storyId) : query ? searchUrl(query) : null
  return clipTrend(
    {
      name: trend.name,
      rank: trend.rank ?? null,
      context: trend.context ?? null,
      grouped: trend.grouped,
      query,
      url,
      story: storyId !== null,
    },
    readAt,
  )
}

/** The rows of a page of trends: the bridge's `trends`. */
export const ACCOUNT_TREND_ROWS: AccountRows<Trend> = { key: "trends", read: trendFromAccount }
