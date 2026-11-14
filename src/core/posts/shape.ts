import { z } from "zod"
import { ToolError, type ErrorDetails } from "../errors"
import type { Answerer } from "../sources/source"

/** The most characters of a post's text a result keeps. */
export const MAX_POST_TEXT = 2000

/** The most characters of a quoted post's text a result keeps. */
export const MAX_QUOTE_TEXT = 280

/** The most characters of an author's name a result keeps. */
export const MAX_NAME = 50

/** The most links of a post a result keeps. */
export const MAX_LINKS = 5

/** The kinds of media a post carries. */
export const MEDIA_TYPES = ["photo", "video", "gif"] as const

/** What a source can say of the community note on a post. */
export const COMMUNITY_NOTE_STATUSES = ["shown", "none", "unknown"] as const

/** A post id: decimal digits only, as X's ids are. */
export const POST_ID_PATTERN = /^[0-9]{1,20}$/

/** A number field a source may leave out or send as `null`. */
export const nullishNumber = z.number().nullish()

/** The six count fields as source payloads carry them. */
export const nullishCountsShape = {
  replies: nullishNumber,
  reposts: nullishNumber,
  likes: nullishNumber,
  quotes: nullishNumber,
  bookmarks: nullishNumber,
  views: nullishNumber,
}

const UNEXPECTED_REPLY_SUBJECT: Readonly<Record<Answerer, string>> = {
  fxtwitter: "FxTwitter",
  account: "The reading account",
}

export const authorSchema = z.object({
  id: z.string().nullable(),
  handle: z.string(),
  name: z.string(),
})

export const mediaSchema = z.object({
  type: z.enum(MEDIA_TYPES),
  url: z.string(),
  alt_text: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  duration_seconds: z.number().nullable(),
})

export const countsSchema = z.object({
  replies: z.number().nullable(),
  reposts: z.number().nullable(),
  likes: z.number().nullable(),
  quotes: z.number().nullable(),
  bookmarks: z.number().nullable(),
  views: z.number().nullable(),
})

/** A post without its own `reply_to` and `quote`: what a post quotes. */
export const quoteSchema = z.object({
  id: z.string(),
  url: z.string(),
  author: authorSchema,
  created_at: z.string().nullable(),
  text: z.string(),
  lang: z.string().nullable(),
  media: z.array(mediaSchema),
  links: z.array(z.string()),
  counts: countsSchema,
  sensitive: z.boolean().nullable(),
})

/** What a post's community note comes to: the note X shows, none, or a source that cannot tell. */
export const communityNoteSchema = z
  .strictObject({
    status: z
      .enum(COMMUNITY_NOTE_STATUSES)
      .describe("`shown`: X shows a note on the post. `none`: it shows none. `unknown`: the source cannot tell."),
    text: z
      .string()
      .nullable()
      .describe("The note's text, only when it is shown; other people's text, like the post's."),
  })
  .describe(
    "The community note X shows on the post. `unknown` is not `none`: a source that cannot tell, such as the reading account, says so.",
  )

export const postSchema = quoteSchema.extend({
  reply_to: z.object({ id: z.string(), handle: z.string().nullable() }).nullable(),
  quote: quoteSchema.nullable(),
  read_at: z
    .string()
    .describe(
      "When the source answered this post, ISO 8601 in UTC to the second, so reads taken at other times compare.",
    ),
  community_note: communityNoteSchema,
  clipped: z
    .array(z.string())
    .describe(
      'The paths that were clipped, such as "text", "quote.text", "author.name", "links" or "community_note.text".',
    ),
})

export type Author = z.infer<typeof authorSchema>
export type Media = z.infer<typeof mediaSchema>
export type Counts = z.infer<typeof countsSchema>
export type CommunityNote = z.infer<typeof communityNoteSchema>
/** A post without its own `reply_to` and `quote`. */
export type Quote = z.infer<typeof quoteSchema>
/** One post, whichever source answered; a field a source does not give is null. */
export type Post = z.infer<typeof postSchema>
/** A post before its clipping: `clipPost` fills `clipped`. */
export type RawPost = Omit<Post, "clipped">

/** The canonical URL of a post. */
export function postUrl(handle: string, id: string): string {
  return `https://x.com/${handle}/status/${id}`
}

/** ISO 8601 in UTC, to the second, for a time in epoch milliseconds; null when it is no time. */
export function isoUtc(ms: number): string | null {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

/** `read_at` for the moment `ms` (epoch milliseconds) a source answered; `internal_error` when the clock gave no time. */
export function readAtOf(ms: number): string {
  const readAt = isoUtc(ms)
  if (readAt === null) throw new ToolError("internal_error", "The clock gave no valid time to stamp the read with.")
  return readAt
}

/** Maps a source's count fields into `Counts`, turning omitted or null values into `null`. */
export function mapCounts(counts: Partial<Record<keyof Counts, number | null>>): Counts {
  return {
    replies: counts.replies ?? null,
    reposts: counts.reposts ?? null,
    likes: counts.likes ?? null,
    quotes: counts.quotes ?? null,
    bookmarks: counts.bookmarks ?? null,
    views: counts.views ?? null,
  }
}

/** An `upstream_error` (`details.reason: "unexpected_reply"`) for a reply off the shape `source` documents. */
export function unexpectedReplyError(source: Answerer, options?: { status?: number; cause?: unknown }): ToolError {
  const details: ErrorDetails = {
    source,
    reason: "unexpected_reply",
    ...(options?.status === undefined ? {} : { status: options.status }),
  }
  return new ToolError(
    "upstream_error",
    `${UNEXPECTED_REPLY_SUBJECT[source]}'s reply was not in the shape this tool reads.`,
    {
      ...(options && "cause" in options ? { cause: options.cause } : {}),
      details,
    },
  )
}

/** Throws `invalid_argument` unless `id` is a decimal string of 1 to 20 digits. */
export function assertPostId(id: string): void {
  if (!POST_ID_PATTERN.test(id)) {
    throw new ToolError("invalid_argument", "A post id is a decimal number of 1 to 20 digits.")
  }
}

/** The first `limit` code points of `text`, never splitting a surrogate pair. */
export function clipCodePoints(text: string, limit: number): string {
  // A code point takes at least one UTF-16 unit, so a text within the limit in units is within it in points.
  if (text.length <= limit) return text
  const points = Array.from(text)
  return points.length <= limit ? text : points.slice(0, limit).join("")
}

/** `fields` with its text, author name and links clipped; the paths of what was clipped (under `prefix`) are added to `clipped`. */
function clipFields<T extends Quote>(fields: T, textLimit: number, prefix: string, clipped: string[]): T {
  const text = clipCodePoints(fields.text, textLimit)
  const name = clipCodePoints(fields.author.name, MAX_NAME)
  const links = fields.links.slice(0, MAX_LINKS)
  if (text !== fields.text) clipped.push(`${prefix}text`)
  if (name !== fields.author.name) clipped.push(`${prefix}author.name`)
  if (links.length !== fields.links.length) clipped.push(`${prefix}links`)
  return { ...fields, text, author: { ...fields.author, name }, links }
}

/** `note` with its text clipped to `MAX_POST_TEXT` code points; the path is added to `clipped` when it was cut. */
function clipNote(note: CommunityNote, clipped: string[]): CommunityNote {
  if (note.text === null) return note
  const text = clipCodePoints(note.text, MAX_POST_TEXT)
  if (text !== note.text) clipped.push("community_note.text")
  return { ...note, text }
}

/**
 * The post with its text clipped to `MAX_POST_TEXT` code points, its quote's
 * text to `MAX_QUOTE_TEXT`, its community note's text to `MAX_POST_TEXT`, each
 * author's name to `MAX_NAME` and each list of links to `MAX_LINKS`; `clipped`
 * names what was cut (empty when nothing was).
 */
export function clipPost(raw: RawPost): Post {
  const clipped: string[] = []
  const { quote, community_note: note, ...rest } = raw
  const post = clipFields(rest, MAX_POST_TEXT, "", clipped)
  return {
    ...post,
    quote: quote && clipFields(quote, MAX_QUOTE_TEXT, "quote.", clipped),
    community_note: clipNote(note, clipped),
    clipped,
  }
}

/** What a lookup of one post came to: the post, or why there is none. */
export type PostLookup =
  { status: "ok"; post: Post } | { status: "not_found" | "protected" | "unavailable"; reason: string }
