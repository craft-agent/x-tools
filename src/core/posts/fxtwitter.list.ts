import { z } from "zod"
import { ToolError } from "../errors"
import type { FxClient } from "../fxtwitter/client"
import type { FxOutcome } from "../sources/choose"
import type { Page } from "../sources/page"
import { HTTP_OK, fxPost, readFxRoute } from "./fxtwitter"
import { clipCodePoints, readAtOf, unexpectedReplyError, type Post } from "./shape"

/** The most characters of FxTwitter's own words a refusal repeats. */
const MAX_REFUSAL_TEXT = 200

/** Where FxTwitter reads a list: a path of its v2 API, and the query-string fields that decide what it holds. */
export type FxListRoute = { path: string; params: Readonly<Record<string, string>> }

/** What a page of a list asks of FxTwitter. */
export type FxListAsk = {
  /** Sent as `count`, and the most posts the page keeps. */
  limit: number
  /** FxTwitter's own cursor, sent as `cursor` when it continues a page. */
  cursor: string | null
  /** The clock in epoch milliseconds that stamps `read_at`. */
  now: () => number
}

/** The cursors of a reply that pages; a cursor of another shape ends the paging. */
export const cursorFieldSchema = z.object({ bottom: z.string().nullish() }).nullish().catch(null)

/** The body of a list: its rows, and the cursors that continue it. */
const listBodySchema = z.object({
  results: z.array(z.unknown()),
  cursor: cursorFieldSchema,
})

/** What FxTwitter says when it refuses a request. */
const refusalSchema = z.object({ message: z.string().nullish(), error: z.string().nullish() })

/** The path and query string of one page: the route's fields, then `count`, then `cursor` when continuing. */
export function pagePath({ path, params }: FxListRoute, { limit, cursor }: FxListAsk): string {
  const query = new URLSearchParams({ ...params, count: String(limit) })
  if (cursor !== null) query.set("cursor", cursor)
  return `${path}?${query}`
}

/** Whether `row` is of `type`; the other rows, such as tombstones, are skipped. */
export function isRowOfType(row: unknown, type: string): boolean {
  return typeof row === "object" && row !== null && "type" in row && row.type === type
}

/** Whether `row` is a status; the other rows, such as tombstones, are skipped. */
export function isStatusRow(row: unknown): boolean {
  return isRowOfType(row, "status")
}

/** What a list holds: which rows are its items, the others being skipped, and what an item is made of its row, read at `readAt`. */
export type FxRows<T> = {
  isItem: (row: unknown) => boolean
  read: (row: unknown, readAt: string) => T
}

/** The rows of a list of posts: its statuses. */
const POST_ROWS: FxRows<Post> = { isItem: isStatusRow, read: fxPost }

/** The cursor that continues a page of `rowCount` rows: `cursor.bottom`, null when the page has no rows or no usable bottom. */
export function nextCursor(rowCount: number, cursor: z.infer<typeof cursorFieldSchema>): string | null {
  const bottom = cursor?.bottom
  return rowCount > 0 && bottom ? bottom : null
}

/** The page a `200` body holds: the items of its rows (the other rows are skipped), at most `limit`, read as the reply arrived. */
export function pageOfRows<T>(body: unknown, { limit, now }: FxListAsk, rows: FxRows<T>): Page<T> {
  const parsed = listBodySchema.safeParse(body)
  if (!parsed.success) throw unexpectedReplyError("fxtwitter", { status: HTTP_OK })
  const { results, cursor } = parsed.data
  const readAt = readAtOf(now())
  const items = results
    .filter(rows.isItem)
    .slice(0, limit)
    .map((row) => rows.read(row, readAt))
  return { items, cursor: nextCursor(results.length, cursor) }
}

/** The page a `200` body holds: its statuses (other rows, such as tombstones, are skipped), at most `limit`, read as the reply arrived. */
export function pageOf(body: unknown, ask: FxListAsk): Page<Post> {
  return pageOfRows(body, ask, POST_ROWS)
}

/** The error of a query FxTwitter refuses, with its words clipped; it names no source, since X would refuse the query too. */
function refusedQueryError(body: unknown): ToolError {
  const refusal = refusalSchema.safeParse(body)
  const said = refusal.success ? (refusal.data.message || refusal.data.error || "").trim().replace(/\.$/, "") : ""
  const text = clipCodePoints(said, MAX_REFUSAL_TEXT)
  return new ToolError(
    "invalid_argument",
    text ? `FxTwitter refused the query: ${text}.` : "FxTwitter refused the query.",
  )
}

/**
 * Reads one page of a list of FxTwitter (`GET` of the route's path with its
 * fields, `count` and, when continuing, `cursor`):
 *
 * - `200` with `results`: an `answer`, the items of the rows `rows` takes (the
 *   others are skipped) and `cursor.bottom` as the next cursor, null when the
 *   page has no rows.
 * - `404`: an `answer`, an empty page with no cursor, FxTwitter's way to say
 *   there is nothing.
 * - `400`: `invalid_argument` with FxTwitter's words clipped. It does not name
 *   FxTwitter as the source, so `auto` does not take it to the reading
 *   account, which X would refuse it too.
 * - Anything else, a body off shape included: `upstream_error` with
 *   `details.reason` `unexpected_reply`.
 *
 * What the client throws (a 429, a 5xx, a failed request) propagates.
 */
export async function readRowsFromFxTwitter<T>(
  client: FxClient,
  route: FxListRoute,
  ask: FxListAsk,
  rows: FxRows<T>,
): Promise<FxOutcome<Page<T>>> {
  return readFxRoute(client, pagePath(route, ask), {
    found: (body) => pageOfRows(body, ask, rows),
    notFound: () => ({ kind: "answer", value: { items: [], cursor: null } }),
    badRequest: (body) => {
      throw refusedQueryError(body)
    },
  })
}

/** Reads one page of a list of posts of FxTwitter, as `readRowsFromFxTwitter` does, its items the rows of `type: "status"`. */
export async function readListFromFxTwitter(
  client: FxClient,
  route: FxListRoute,
  ask: FxListAsk,
): Promise<FxOutcome<Page<Post>>> {
  return readRowsFromFxTwitter(client, route, ask, POST_ROWS)
}
