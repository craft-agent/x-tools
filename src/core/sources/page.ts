import { z } from "zod"
import type { FxClient } from "../fxtwitter/client"
import { readFromSources, type FxOutcome } from "./choose"
import { decodeCursor, encodeCursor, type CursorParts } from "./cursor"
import type { Reader } from "./reader"
import { ANSWERERS, type Answerer, type Source } from "./source"

/** The items a paged read returns when `limit` is left out. */
export const DEFAULT_LIMIT = 20

/** The most items a paged read may be asked for. */
export const MAX_LIMIT = 50

/** The longest `cursor` a call may carry, in characters. */
export const MAX_CURSOR_LENGTH = 2000

/** The `limit` argument of every paged read. */
export const limitArgument = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .optional()
  .describe(`Most items in the page, ${DEFAULT_LIMIT} by default; a page may hold fewer with more to come.`)

/** The `cursor` argument of every paged read. */
export const cursorArgument = z
  .string()
  .max(MAX_CURSOR_LENGTH)
  .optional()
  .describe(
    "The `cursor` a previous page returned, to continue it: on the source that gave it, with the same arguments.",
  )

/** The fields every paged result holds beside its items. */
export const pageResultShape = {
  source: z.enum(ANSWERERS).describe("The source that answered this page."),
  cursor: z
    .string()
    .nullable()
    .describe("Pass it as `cursor`, with the same arguments, for the next page; null when there is no more."),
}

/**
 * One page as a source gave it, with that source's own next cursor (null at
 * the end), and the fields `E` it carries beside them (none for a plain list).
 */
export type Page<T, E extends object = {}> = { items: T[]; cursor: string | null } & E

/** A paged read as the two sources do it; `fxtwitter` is absent when FxTwitter does not offer the read. */
export type PagedRead<T, E extends object = {}> = {
  fxtwitter?: (client: FxClient, cursor: string | null) => Promise<FxOutcome<Page<T, E>>>
  account: (reader: Reader, cursor: string | null) => Promise<Page<T, E>>
}

/** What a call asks of a page: the read, the arguments that decide it, its `source` and the `cursor` it continues. */
export type PageRequest = Pick<CursorParts, "read" | "args"> & { source?: Source; cursor?: string }

/** A page with its extra fields, the source that answered it and the cursor for the next one. */
export type PageAnswer<T, E extends object = {}> = { source: Answerer } & Page<T, E>

/**
 * Reads one page of `paged` on the sources the call chose.
 *
 * Without `cursor` the first page is read as `readFromSources` reads, FxTwitter
 * first under `auto`. With one, it must be the cursor of this read, these
 * arguments and this `source` (`invalid_argument` otherwise, before anything is
 * read), and the page is read only on the source that gave it, from its own
 * cursor: FxTwitter's errors propagate and never fall to the reading account,
 * whose cursor FxTwitter could not continue.
 *
 * The returned `cursor` names the source that answered, the read and the
 * arguments, so the next call continues there; null when the source has no
 * more pages. Fields the page carries beside `items` and `cursor` come back
 * unchanged.
 */
export async function readPage<T, E extends object = {}>(
  reader: Reader,
  { read, args, source, cursor }: PageRequest,
  paged: PagedRead<T, E>,
): Promise<PageAnswer<T, E>> {
  const from =
    cursor === undefined ? null : decodeCursor(cursor, { read, args, source, accountOnly: reader.accountOnly })
  const own = from?.cursor ?? null
  const { fxtwitter } = paged
  const answered = await readFromSources(reader, from?.source ?? source, {
    fxtwitter: fxtwitter && ((client) => fxtwitter(client, own)),
    account: (accountReader) => paged.account(accountReader, own),
  })
  const next = answered.value.cursor
  return {
    ...answered.value,
    source: answered.source,
    cursor: next ? encodeCursor({ source: answered.source, read, args, cursor: next }) : null,
  }
}
