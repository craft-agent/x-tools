import { clipCodePoints } from "../posts/shape"
import { MAX_GROUPED, MAX_TREND_NAME, type Trend } from "./schemas"

/** What a trend is made of before it is clipped and stamped: the fields the two sources agree on. */
export type TrendFields = Omit<Trend, "read_at" | "clipped">

/** The trend's search on x.com for `query`. */
export function searchUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}`
}

/**
 * The trend `fields` make, read at `readAt` (ISO 8601 UTC): its name and each
 * grouped topic clipped to `MAX_TREND_NAME` code points and at most
 * `MAX_GROUPED` topics kept; `clipped` names what was cut, `name` or
 * `grouped`.
 */
export function clipTrend(fields: TrendFields, readAt: string): Trend {
  const name = clipCodePoints(fields.name, MAX_TREND_NAME)
  const grouped = fields.grouped.slice(0, MAX_GROUPED).map((topic) => clipCodePoints(topic, MAX_TREND_NAME))
  const clipped: string[] = []
  if (name !== fields.name) clipped.push("name")
  if (grouped.length !== fields.grouped.length || grouped.some((topic, i) => topic !== fields.grouped[i])) {
    clipped.push("grouped")
  }
  return { ...fields, name, grouped, read_at: readAt, clipped }
}
