import { describe, expect, test } from "bun:test"
import { fxPost } from "./fxtwitter"
import {
  CREATED_AT,
  PARENT_ID,
  POST_ID,
  QUOTE_ID,
  fxLinkFacet,
  fxMosaic,
  fxPhoto,
  fxStatus,
  fxTombstone,
  fxUser,
  fxVideo,
  unexpectedMatch,
} from "./posts.testing"
import { MAX_LINKS, MAX_POST_TEXT } from "./shape"

const EMPTY_COUNTS = { replies: null, reposts: null, likes: null, quotes: null, bookmarks: null, views: null }

describe("fxPost: a full post", () => {
  const quoted = fxStatus({
    id: QUOTE_ID,
    author: fxUser("grace_reads", "4002", "Grace Reads"),
    text: "The quoted words.",
    created_timestamp: 1767700000,
    possibly_sensitive: true,
    views: null,
  })
  const full = fxStatus({
    media: { all: [fxPhoto(), fxVideo("video"), fxVideo("gif")] },
    raw_text: {
      text: "see https://t.co/a",
      display_text_range: [0, 18],
      facets: [fxLinkFacet("https://t.co/a", "https://example.test/a"), { type: "mention", indices: [0, 4], id: "7" }],
    },
    replying_to: { screen_name: "grace_reads", status: PARENT_ID },
    quote: quoted,
    views: null,
  })

  test("maps the fields of the shape", () => {
    expect(fxPost(full)).toEqual({
      id: POST_ID,
      url: `https://x.com/ada_writes/status/${POST_ID}`,
      author: { id: "4001", handle: "ada_writes", name: "Ada Writes" },
      created_at: CREATED_AT,
      text: "Notes on reading slowly.",
      lang: "en",
      media: [
        {
          type: "photo",
          url: "https://pbs.example.test/media/photo1.jpg",
          alt_text: "A desk with an open book",
          width: 1200,
          height: 800,
          duration_seconds: null,
        },
        {
          type: "video",
          url: "https://video.example.test/video.mp4",
          alt_text: null,
          width: 720,
          height: 1280,
          duration_seconds: 12.5,
        },
        {
          type: "gif",
          url: "https://video.example.test/gif.mp4",
          alt_text: null,
          width: 720,
          height: 1280,
          duration_seconds: 12.5,
        },
      ],
      links: ["https://example.test/a"],
      counts: { replies: 2, reposts: 3, likes: 40, quotes: 1, bookmarks: 5, views: null },
      sensitive: false,
      reply_to: { id: PARENT_ID, handle: "grace_reads" },
      quote: {
        id: QUOTE_ID,
        url: `https://x.com/grace_reads/status/${QUOTE_ID}`,
        author: { id: "4002", handle: "grace_reads", name: "Grace Reads" },
        created_at: "2026-01-06T11:46:40Z",
        text: "The quoted words.",
        lang: "en",
        media: [],
        links: [],
        counts: { replies: 2, reposts: 3, likes: 40, quotes: 1, bookmarks: 5, views: null },
        sensitive: true,
      },
      clipped: [],
    })
  })

  test("builds the canonical url from the handle, not the one FxTwitter wrote", () => {
    const post = fxPost(fxStatus({ url: "https://twitter.com/old_handle/status/1" }))
    expect(post.url).toBe(`https://x.com/ada_writes/status/${POST_ID}`)
  })

  test("is one level: a quote's own quote and reply are not read", () => {
    const nested = fxStatus({
      quote: fxStatus({ id: QUOTE_ID, replying_to: { screen_name: "x", status: "9" }, quote: fxStatus({ id: "9" }) }),
    })
    const quote = fxPost(nested).quote!
    expect(quote.id).toBe(QUOTE_ID)
    expect(quote).not.toHaveProperty("quote")
    expect(quote).not.toHaveProperty("reply_to")
  })

  test("clips the text and says where", () => {
    const post = fxPost(fxStatus({ text: "x".repeat(MAX_POST_TEXT + 1) }))
    expect(post.text).toHaveLength(MAX_POST_TEXT)
    expect(post.clipped).toEqual(["text"])
  })
})

describe("fxPost: media and links", () => {
  test("skips a mosaic and keeps the rest in order", () => {
    const post = fxPost(fxStatus({ media: { all: [fxMosaic(), fxPhoto(), fxMosaic(), fxVideo("video")] } }))
    expect(post.media.map((item) => item.type)).toEqual(["photo", "video"])
  })

  test("takes a photo's missing alt text and a missing size as null", () => {
    const { altText: _altText, width: _width, ...bare } = fxPhoto()
    const [item] = fxPost(fxStatus({ media: { all: [bare] } })).media
    expect(item).toMatchObject({ alt_text: null, width: null, height: 800, duration_seconds: null })
  })

  test("reads a gif the schema types as a photo as a gif without a duration", () => {
    const [item] = fxPost(fxStatus({ media: { all: [fxPhoto({ type: "gif", altText: undefined })] } })).media
    expect(item).toMatchObject({ type: "gif", alt_text: null, duration_seconds: null })
  })

  test("takes the expanded address of a url facet, else its original, once each and in order", () => {
    const facets = [
      fxLinkFacet("https://t.co/a", "https://example.test/a"),
      fxLinkFacet("https://t.co/b"),
      fxLinkFacet("https://t.co/c", "https://example.test/a"),
      { type: "hashtag", indices: [0, 3], original: "#x" },
      { type: "url", indices: [0, 3] },
    ]
    const raw_text = { text: "", display_text_range: [0, 0], facets }
    expect(fxPost(fxStatus({ raw_text })).links).toEqual(["https://example.test/a", "https://t.co/b"])
  })

  test("keeps at most 5 links and says so", () => {
    const facets = Array.from({ length: MAX_LINKS + 2 }, (_, index) =>
      fxLinkFacet(`https://t.co/${index}`, `https://example.test/${index}`),
    )
    const post = fxPost(fxStatus({ raw_text: { text: "", display_text_range: [0, 0], facets } }))
    expect(post.links).toHaveLength(MAX_LINKS)
    expect(post.clipped).toEqual(["links"])
  })
})

describe("fxPost: what is missing or gone", () => {
  test("a quote that is a tombstone is null, whatever the reason", () => {
    for (const reason of ["deleted", "suspended", "private", "blocked", "unavailable"]) {
      expect(fxPost(fxStatus({ quote: fxTombstone(reason) })).quote).toBeNull()
    }
  })

  test("a quote that is absent or null is null", () => {
    expect(fxPost(fxStatus()).quote).toBeNull()
    expect(fxPost(fxStatus({ quote: null })).quote).toBeNull()
  })

  test("fields FxTwitter leaves out are null", () => {
    const {
      views: _views,
      bookmarks: _bookmarks,
      ...status
    } = fxStatus({ lang: null, author: { screen_name: "ada_writes", name: "Ada" } })
    expect(
      fxPost({
        ...status,
        created_timestamp: undefined,
        likes: undefined,
        replies: undefined,
        reposts: undefined,
        quotes: undefined,
        possibly_sensitive: undefined,
        replying_to: undefined,
        raw_text: undefined,
        media: undefined,
      }),
    ).toEqual({
      id: POST_ID,
      url: `https://x.com/ada_writes/status/${POST_ID}`,
      author: { id: null, handle: "ada_writes", name: "Ada" },
      created_at: null,
      text: "Notes on reading slowly.",
      lang: null,
      media: [],
      links: [],
      counts: EMPTY_COUNTS,
      sensitive: null,
      reply_to: null,
      quote: null,
      clipped: [],
    })
  })

  test("a null count is null and a count of 0 is 0", () => {
    const { counts } = fxPost(fxStatus({ likes: 0, views: null, bookmarks: null }))
    expect(counts).toMatchObject({ likes: 0, views: null, bookmarks: null })
  })
})

describe("fxPost: a status off shape", () => {
  const MISSING = ["id", "text", "author"]
  const BROKEN: Record<string, unknown> = {
    "not an object": "status",
    null: null,
    "a list": [],
    "a tombstone, not a status": fxTombstone("deleted"),
    "another type": { ...fxStatus(), type: "profile" },
    "an id that is a number": fxStatus({ id: 1700000000000000001 }),
    "text that is a number": fxStatus({ text: 5 }),
    "an author without a handle": fxStatus({ author: { id: "1", name: "Ada" } }),
    "a count that is text": fxStatus({ likes: "40" }),
    "a timestamp that is text": fxStatus({ created_timestamp: "1767781800" }),
    "a photo without a url": fxStatus({ media: { all: [{ type: "photo", width: 1, height: 1 }] } }),
    "media that is not a list": fxStatus({ media: { all: "photo" } }),
    "a quote that is neither a status nor a tombstone": fxStatus({ quote: { type: "profile" } }),
    "a quote off shape": fxStatus({ quote: fxStatus({ text: 5 }) }),
    "a facet without a type": fxStatus({ raw_text: { facets: [{ original: "x" }] } }),
  }
  for (const field of MISSING) {
    const { [field]: _gone, ...rest } = fxStatus()
    BROKEN[`no ${field}`] = rest
  }

  for (const [name, status] of Object.entries(BROKEN)) {
    test(`${name} is an unexpected_reply`, () => {
      expect(() => fxPost(status)).toThrow(expect.objectContaining(unexpectedMatch("fxtwitter")))
    })
  }
})
