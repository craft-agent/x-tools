import type { Answerer } from "../sources/source"
import type { CommunityNote } from "./shape"

/** Fixtures the post tests share: FxTwitter's v2 status as its schema writes it, a tombstone and the bridge's `post` data, with made-up ids and handles. */

export const POST_ID = "1700000000000000001"
export const QUOTE_ID = "1700000000000000002"
export const PARENT_ID = "1700000000000000003"

/** 2026-01-07T10:30:00Z in seconds. */
export const CREATED_TIMESTAMP = 1767781800
export const CREATED_AT = "2026-01-07T10:30:00Z"

/** The moment the post tests have a source answer, 2026-01-08T09:00:00Z, in milliseconds and as `read_at` writes it. */
export const READ_AT_MS = Date.parse("2026-01-08T09:00:00.000Z")
export const READ_AT = "2026-01-08T09:00:00Z"

/** The `community_note` of a post whose source cannot tell. */
export const UNKNOWN_NOTE: CommunityNote = { status: "unknown", text: null }

/** The `community_note` of a post without one. */
export const NO_NOTE: CommunityNote = { status: "none", text: null }

type Json = Record<string, unknown>

/** The note FxTwitter holds on a post, in v2 (`facets`) or in the legacy form (`entities`). */
export function fxNote(text: string, form: "v2" | "legacy" = "v2"): Json {
  return form === "v2" ? { text, facets: [] } : { text, entities: [] }
}

/** An `APIUser` as a post's author carries it. */
export function fxUser(screenName = "ada_writes", id = "4001", name = "Ada Writes"): Json {
  return {
    type: "profile",
    id,
    name,
    screen_name: screenName,
    avatar_url: "https://pbs.example.test/avatar.jpg",
    banner_url: null,
    description: "",
    raw_description: { text: "", facets: [] },
    location: "",
    url: `https://x.com/${screenName}`,
    protected: false,
    followers: 10,
    following: 5,
    statuses: 100,
    media_count: 3,
    likes: 20,
    joined: "Mon Jan 01 00:00:00 +0000 2018",
    website: null,
    profile_embed: true,
  }
}

/** An `APITwitterStatus` with every field its schema requires; `fields` replace any of them. */
export function fxStatus(fields: Json = {}): Json {
  const author = (fields.author as Json | undefined) ?? fxUser()
  const id = (fields.id as string | undefined) ?? POST_ID
  return {
    type: "status",
    id,
    url: `https://x.com/${author.screen_name}/status/${id}`,
    text: "Notes on reading slowly.",
    created_at: "Wed Jan 07 10:30:00 +0000 2026",
    created_timestamp: CREATED_TIMESTAMP,
    likes: 40,
    reposts: 3,
    quotes: 1,
    replies: 2,
    author,
    media: {},
    raw_text: { text: "Notes on reading slowly.", display_text_range: [0, 24], facets: [] },
    lang: "en",
    possibly_sensitive: false,
    replying_to: null,
    source: "Test Client",
    embed_card: "tweet",
    provider: "twitter",
    views: 1200,
    bookmarks: 5,
    is_note_tweet: false,
    community_note: null,
    reposted_by: null,
    ...fields,
  }
}

/** A photo as `media.all` carries it. */
export function fxPhoto(fields: Json = {}): Json {
  return {
    type: "photo",
    url: "https://pbs.example.test/media/photo1.jpg",
    width: 1200,
    height: 800,
    altText: "A desk with an open book",
    ...fields,
  }
}

/** A video or gif as `media.all` carries it: no alt text, a duration in seconds. */
export function fxVideo(type: "video" | "gif" = "video", fields: Json = {}): Json {
  return {
    type,
    url: `https://video.example.test/${type}.mp4`,
    thumbnail_url: "https://pbs.example.test/media/thumb.jpg",
    width: 720,
    height: 1280,
    duration: 12.5,
    formats: [],
    ...fields,
  }
}

/** A mosaic of photos, which a post's media skips. */
export function fxMosaic(): Json {
  return {
    type: "mosaic_photo",
    formats: { webp: "https://mosaic.example.test/a.webp", jpeg: "https://mosaic.example.test/a.jpg" },
  }
}

/** A `url` facet: the address in the text, and the one it expands to. */
export function fxLinkFacet(original: string, replacement?: string): Json {
  return { type: "url", indices: [0, 10], original, replacement, display: "example.test" }
}

/** The post a quote tombstone stands for. */
export function fxTombstone(reason: string): Json {
  return { type: "tombstone", provider: "twitter", reason, message: "This post is unavailable." }
}

/** A reply of `/2/status/<id>`. */
export function fxReply(code: number, status: unknown): Json {
  return { code, message: code === 200 ? "OK" : "NOT_FOUND", status }
}

/** What the bridge's `post` operation gives for a tweet; `fields` replace any of it. */
export function accountData(fields: Json = {}): Json {
  return {
    id: POST_ID,
    url: `https://x.com/ada_writes/status/${POST_ID}`,
    date: "2026-01-07T10:30:00+00:00",
    user: { id: "4001", username: "ada_writes", displayname: "Ada Writes" },
    text: "Notes on reading slowly.",
    lang: "en",
    replies: 2,
    reposts: 3,
    likes: 40,
    quotes: 1,
    bookmarks: 5,
    views: 1200,
    media: [],
    links: [],
    sensitive: false,
    reply_to: null,
    quote: null,
    ...fields,
  }
}

/** `count` distinct example links, for clipping tests. */
export function sampleLinks(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `https://example.test/${index}`)
}

/** The `ToolError` shape expected for an `unexpected_reply` from `source`. */
export function unexpectedMatch(source: Answerer, status?: number) {
  return {
    code: "upstream_error",
    details: { source, reason: "unexpected_reply", ...(status === undefined ? {} : { status }) },
  }
}
