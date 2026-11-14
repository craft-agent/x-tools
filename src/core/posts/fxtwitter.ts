import { z } from "zod"
import type { FxClient } from "../fxtwitter/client"
import type { FxOutcome } from "../sources/choose"
import {
  MEDIA_TYPES,
  POST_NOT_FOUND,
  assertPostId,
  clipPost,
  isoUtc,
  mapCounts,
  nullishCountsShape,
  nullishNumber,
  postUrl,
  readAtOf,
  unexpectedReplyError,
  type CommunityNote,
  type Media,
  type Post,
  type Quote,
  type PostGone,
  type PostLookup,
} from "./shape"

const STATUS_PATH = "/2/status/"

export const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
export const HTTP_UNAUTHORIZED = 401
export const HTTP_NOT_FOUND = 404

/** A media item of a kind this package reads. */
const knownMediaSchema = z.object({
  type: z.enum(MEDIA_TYPES),
  url: z.string(),
  width: nullishNumber,
  height: nullishNumber,
  altText: z.string().nullish(),
  duration: nullishNumber,
})

/** A media item of any other kind, such as a mosaic: skipped. */
const otherMediaSchema = z.object({
  type: z.string().refine((type) => !isMediaType(type)),
})

const facetSchema = z.object({ type: z.string(), original: z.string().nullish(), replacement: z.string().nullish() })

const statusFieldsSchema = z.object({
  type: z.literal("status"),
  id: z.string(),
  text: z.string(),
  created_timestamp: nullishNumber,
  author: z.object({ id: z.string().nullish(), screen_name: z.string(), name: z.string() }),
  lang: z.string().nullish(),
  replying_to: z.object({ screen_name: z.string(), status: z.string() }).nullish(),
  media: z.object({ all: z.array(z.union([knownMediaSchema, otherMediaSchema])).nullish() }).nullish(),
  raw_text: z.object({ facets: z.array(facetSchema).nullish() }).nullish(),
  ...nullishCountsShape,
  possibly_sensitive: z.boolean().nullish(),
})

/** A quote that is gone: FxTwitter says so with a tombstone, and the post has no quote then. */
const tombstoneSchema = z.object({ type: z.literal("tombstone") })

/** The community note FxTwitter holds on a post, in v2 (`facets`) and in the legacy form (`entities`): only its text is read. */
const communityNoteFieldSchema = z.object({ text: z.string() })

const statusSchema = statusFieldsSchema.extend({
  quote: z.union([statusFieldsSchema, tombstoneSchema]).nullish(),
  community_note: communityNoteFieldSchema.nullish(),
})

/** Why FxTwitter reports a post as gone. */
const goneSchema = z.object({
  type: z.literal("tombstone"),
  reason: z.enum(["deleted", "suspended", "private", "blocked", "unavailable"]),
})

type FxStatusFields = z.infer<typeof statusFieldsSchema>
type FxMediaItem = z.infer<typeof knownMediaSchema> | z.infer<typeof otherMediaSchema>
type FxFacet = z.infer<typeof facetSchema>

function isMediaType(type: string): boolean {
  return (MEDIA_TYPES as readonly string[]).includes(type)
}

function mapMedia(items: FxMediaItem[]): Media[] {
  return items.flatMap((item) => {
    if (!("url" in item)) return []
    const isPhoto = item.type === "photo"
    return {
      type: item.type,
      url: item.url,
      alt_text: isPhoto ? (item.altText ?? null) : null,
      width: item.width ?? null,
      height: item.height ?? null,
      duration_seconds: isPhoto ? null : (item.duration ?? null),
    }
  })
}

/** The links of a post's text: each `url` facet's expanded address, else its original, each once and in order. */
function mapLinks(facets: FxFacet[]): string[] {
  const links = facets.flatMap((facet) => {
    const link = facet.type === "url" ? (facet.replacement ?? facet.original) : undefined
    return link ? [link] : []
  })
  return [...new Set(links)]
}

function mapQuote(status: FxStatusFields): Quote {
  const handle = status.author.screen_name
  return {
    id: status.id,
    url: postUrl(handle, status.id),
    author: { id: status.author.id ?? null, handle, name: status.author.name },
    created_at: status.created_timestamp == null ? null : isoUtc(status.created_timestamp * 1000),
    text: status.text,
    lang: status.lang ?? null,
    media: mapMedia(status.media?.all ?? []),
    links: mapLinks(status.raw_text?.facets ?? []),
    counts: mapCounts(status),
    sensitive: status.possibly_sensitive ?? null,
  }
}

/** The community note of a status: `shown` with its text, `none` for a `null`, and `unknown` when FxTwitter leaves the field out. */
function mapNote(note: z.infer<typeof communityNoteFieldSchema> | null | undefined): CommunityNote {
  if (note === undefined) return { status: "unknown", text: null }
  return note === null ? { status: "none", text: null } : { status: "shown", text: note.text }
}

/** The post `status` holds, clipped, read at `readAt`; `httpStatus` goes into the error of a status that is off shape. */
function postFrom(status: unknown, readAt: string, httpStatus?: number): Post {
  const parsed = statusSchema.safeParse(status)
  if (!parsed.success) throw unexpectedReplyError("fxtwitter", { status: httpStatus })
  const { quote, replying_to: replyingTo, community_note: note } = parsed.data
  return clipPost({
    ...mapQuote(parsed.data),
    reply_to: replyingTo ? { id: replyingTo.status, handle: replyingTo.screen_name } : null,
    quote: quote?.type === "status" ? mapQuote(quote) : null,
    read_at: readAt,
    community_note: mapNote(note),
  })
}

/**
 * The post a v2 `APITwitterStatus` (`type: "status"`) holds, read at `readAt`
 * (ISO 8601 UTC): the same shape whichever source answered, clipped, with a
 * field FxTwitter leaves out null. A quote that is a tombstone or absent is
 * null; a mosaic among the media is skipped. The community note is `shown`
 * with its text, `none` when FxTwitter says `null`, and `unknown` when it
 * leaves the field out. A status that is off shape, a note without a text
 * included, throws `upstream_error` with `details.reason` `unexpected_reply`.
 */
export function fxPost(status: unknown, readAt: string): Post {
  return postFrom(status, readAt)
}

/** The `status` field of a reply's body; throws `unexpected_reply` for a body that is not an object holding one. */
function statusField(body: unknown, httpStatus: number): unknown {
  if (typeof body !== "object" || body === null || !("status" in body)) {
    throw unexpectedReplyError("fxtwitter", { status: httpStatus })
  }
  return body.status
}

/** What a `401` came to: a `fallback` for the reading account, `protected`. */
export const PROTECTED_OUTCOME: FxOutcome<PostGone> = {
  kind: "fallback",
  reason: "protected",
  value: { status: "protected", reason: "protected" },
}

/** What a `404` came to: `not_found` for a post that is gone for good, the reading account's to try for the rest. */
function goneOutcome(body: unknown): FxOutcome<PostGone> {
  const gone = statusField(body, HTTP_NOT_FOUND)
  // A bare 404 is also how FxTwitter reports a fetch it failed; it is final all the same.
  if (gone === null) return { kind: "answer", value: POST_NOT_FOUND }
  const tombstone = goneSchema.safeParse(gone)
  if (!tombstone.success) throw unexpectedReplyError("fxtwitter", { status: HTTP_NOT_FOUND })
  const { reason } = tombstone.data
  switch (reason) {
    case "deleted":
    case "suspended":
      return { kind: "answer", value: { status: "not_found", reason } }
    case "private":
      return { kind: "fallback", reason: "protected", value: { status: "protected", reason } }
    case "blocked":
    case "unavailable":
      return { kind: "fallback", reason: "logged_out", value: { status: "unavailable", reason } }
  }
}

/**
 * Reads `path` of FxTwitter and dispatches on HTTP status: `200` is an
 * `answer` of `found(body)`; `404` is `notFound(body)`; `401` is
 * `unauthorized(PROTECTED_OUTCOME)` when given; `400` calls `badRequest(body)`
 * when given; anything else, a body off shape included, throws `upstream_error`
 * (`unexpected_reply`).
 */
export async function readFxRoute<T>(
  client: FxClient,
  path: string,
  handlers: {
    found: (body: unknown) => T
    notFound: (body: unknown) => FxOutcome<T>
    unauthorized?: (outcome: FxOutcome<PostGone>) => FxOutcome<T>
    badRequest?: (body: unknown) => never
  },
): Promise<FxOutcome<T>> {
  const { status, body } = await client.get(path)
  switch (status) {
    case HTTP_OK:
      return { kind: "answer", value: handlers.found(body) }
    case HTTP_UNAUTHORIZED:
      if (handlers.unauthorized) return handlers.unauthorized(PROTECTED_OUTCOME)
      break
    case HTTP_NOT_FOUND:
      return handlers.notFound(body)
    case HTTP_BAD_REQUEST:
      if (handlers.badRequest) handlers.badRequest(body)
      break
  }
  throw unexpectedReplyError("fxtwitter", { status })
}

/**
 * Reads `path` of FxTwitter as a post-keyed route: `200` is an `answer` of
 * what `found` makes of its body; `401` and `404` say what the post came to as
 * a single post's read does, and `gone` turns that into the value; anything
 * else, a body off shape included, is `upstream_error` (`unexpected_reply`).
 */
export async function readStatusRoute<T>(
  client: FxClient,
  path: string,
  found: (body: unknown) => T,
  gone: (gone: PostGone) => T,
): Promise<FxOutcome<T>> {
  return readFxRoute(client, path, {
    found,
    unauthorized: (outcome) => ({ ...outcome, value: gone(outcome.value) }),
    notFound: (body) => {
      const outcome = goneOutcome(body)
      return { ...outcome, value: gone(outcome.value) }
    },
  })
}

/**
 * Reads one post of FxTwitter (`GET /2/status/<id>`) as the choice between
 * the sources needs it:
 *
 * - `200` with a status: an `answer`, the post.
 * - `404` with a `deleted` or `suspended` tombstone, or none: an `answer`,
 *   `not_found`; it is final.
 * - `401`, and a `private` tombstone: a `fallback` for the reading account,
 *   `protected`. A `blocked` or `unavailable` tombstone: a `fallback`,
 *   `unavailable`, for a post only a signed-in reader may see.
 * - Anything else, a body off shape included: `upstream_error` with
 *   `details.reason` `unexpected_reply`.
 *
 * The post's `read_at` is the time `now` tells as the reply arrives.
 * What the client throws (a 429, a 5xx, a failed request) propagates.
 * Throws `invalid_argument` for an `id` that is not a decimal number.
 */
export async function readPostFromFxTwitter(
  client: FxClient,
  id: string,
  now: () => number,
): Promise<FxOutcome<PostLookup>> {
  assertPostId(id)
  return readStatusRoute<PostLookup>(
    client,
    `${STATUS_PATH}${id}`,
    (body) => ({ status: "ok", post: postFrom(statusField(body, HTTP_OK), readAtOf(now()), HTTP_OK) }),
    (gone) => gone,
  )
}
