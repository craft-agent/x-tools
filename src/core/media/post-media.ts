import { z } from "zod"
import type { FxClient } from "../fxtwitter/client"
import { HTTP_OK, STATUS_PATH, readStatusRoute, statusField } from "../posts/fxtwitter"
import {
  MEDIA_TYPES,
  POST_NOT_FOUND,
  assertPostId,
  nullishNumber,
  unexpectedReplyError,
  type PostGone,
} from "../posts/shape"
import type { FxOutcome } from "../sources/choose"
import type { Reader } from "../sources/reader"
import type { MediaKind } from "./cdn"

/** The media one post carries that can be saved, in the post's order; a video or GIF with no MP4 has a null `url`. */
export type MediaItem = { kind: MediaKind; url: string | null }

/** The media of a post, by the id of the post they belong to. */
export type PostMedia = { id: string; items: MediaItem[] }

/** What a read of one post's media came to: the media of the post and of the post it quotes, or why there is none. */
export type MediaLookup = { status: "ok"; items: MediaItem[]; quote: PostMedia | null } | PostGone

const MP4_CONTAINER = "mp4"
const MP4_EXTENSION = ".mp4"

/** One of the encodings FxTwitter offers a video; only the fields the choice needs. */
const formatSchema = z.object({
  container: z.string().nullish(),
  codec: z.string().nullish(),
  bitrate: nullishNumber,
  url: z.string(),
  size: nullishNumber,
})

/** A media item of a kind this tool saves. `formats` is read leniently: a shape it does not know leaves the item's own `url`. */
const knownMediaSchema = z.object({
  type: z.enum(MEDIA_TYPES),
  url: z.string(),
  formats: z.unknown().optional(),
})

/** A media item of any other kind, such as a mosaic: skipped. */
const otherMediaSchema = z.object({
  type: z.string().refine((type) => !(MEDIA_TYPES as readonly string[]).includes(type)),
})

const mediaStatusSchema = z.object({
  type: z.literal("status"),
  id: z.string(),
  media: z.object({ all: z.array(z.union([knownMediaSchema, otherMediaSchema])).nullish() }).nullish(),
})

/** A quote that is gone: FxTwitter says so with a tombstone, and the post has no quote then. */
const tombstoneSchema = z.object({ type: z.literal("tombstone") })

const fxStatusSchema = mediaStatusSchema.extend({ quote: z.union([mediaStatusSchema, tombstoneSchema]).nullish() })

/** What the bridge's `post` operation gives of the media of a tweet: its video URL is already the best MP4. */
const accountMediaSchema = z.object({
  id: z.string(),
  media: z.array(z.object({ type: z.enum(MEDIA_TYPES), url: z.string() })),
})

const accountPostSchema = accountMediaSchema.extend({ quote: accountMediaSchema.nullish() })

type FxMediaStatus = z.infer<typeof mediaStatusSchema>
type AccountMedia = z.infer<typeof accountMediaSchema>

/** Whether `url` is a path ending in `.mp4`, before any query. */
function endsInMp4(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(MP4_EXTENSION)
  } catch {
    return false
  }
}

/** The URL of the MP4 among `formats` with the highest bitrate (a missing one counts 0, and the first of equals wins), else null. */
function bestMp4(formats: unknown): string | null {
  if (!Array.isArray(formats)) return null
  let best: z.infer<typeof formatSchema> | undefined
  for (const entry of formats) {
    const format = formatSchema.safeParse(entry)
    if (!format.success || format.data.container !== MP4_CONTAINER) continue
    if (best === undefined || (format.data.bitrate ?? 0) > (best.bitrate ?? 0)) best = format.data
  }
  return best?.url ?? null
}

/** The media FxTwitter's status holds, in its order: a photo's own URL, a video's or GIF's best MP4 (else its own URL when that is one). */
function fxItems(status: FxMediaStatus): MediaItem[] {
  return (status.media?.all ?? []).flatMap((item): MediaItem[] => {
    if (!("url" in item)) return []
    if (item.type === "photo") return [{ kind: "photo", url: item.url }]
    return [{ kind: item.type, url: bestMp4(item.formats) ?? (endsInMp4(item.url) ? item.url : null) }]
  })
}

/** The media of a v2 status body; `unexpected_reply` for one that is off shape. */
function fxLookup(body: unknown): MediaLookup {
  const parsed = fxStatusSchema.safeParse(statusField(body, HTTP_OK))
  if (!parsed.success) throw unexpectedReplyError("fxtwitter", { status: HTTP_OK })
  const { quote } = parsed.data
  return {
    status: "ok",
    items: fxItems(parsed.data),
    quote: quote?.type === "status" ? { id: quote.id, items: fxItems(quote) } : null,
  }
}

/**
 * Reads the media of one post of FxTwitter (`GET /2/status/<id>`) as the choice
 * between the sources needs it: a `401` and a `private`, `blocked` or
 * `unavailable` tombstone fall to the reading account, a `deleted` or
 * `suspended` tombstone and a bare `404` are final, exactly as for
 * `x_post_read`'s `view`. A photo's URL is its own; a video's or GIF's is the
 * `mp4` format with the highest bitrate (a missing one counts 0), else the
 * item's own URL when it ends in `.mp4` before any query, else null. A
 * mosaic is skipped. The quote's media come from the same reply.
 */
export async function readMediaFromFxTwitter(client: FxClient, id: string): Promise<FxOutcome<MediaLookup>> {
  assertPostId(id)
  return readStatusRoute<MediaLookup>(client, `${STATUS_PATH}${id}`, fxLookup, (gone) => gone)
}

function accountItems(tweet: AccountMedia): MediaItem[] {
  return tweet.media.map((item) => ({ kind: item.type, url: item.url }))
}

/**
 * Reads the media of one post through the reading account `account` (the only
 * one when left out): one paced read of the bridge's `post` operation, whose
 * video URLs are already the best MP4. No tweet from X is `not_found`.
 */
export async function readMediaFromAccount(reader: Reader, id: string, account?: string): Promise<MediaLookup> {
  assertPostId(id)
  const { data } = await reader.account("post", { id }, account)
  if (data === null) return POST_NOT_FOUND
  const parsed = accountPostSchema.safeParse(data)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  const { quote } = parsed.data
  return {
    status: "ok",
    items: accountItems(parsed.data),
    quote: quote ? { id: quote.id, items: accountItems(quote) } : null,
  }
}
