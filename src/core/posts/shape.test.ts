import { describe, expect, test } from "bun:test"
import {
  CREATED_AT,
  NO_NOTE,
  PARENT_ID,
  POST_ID,
  QUOTE_ID,
  READ_AT,
  READ_AT_MS,
  UNKNOWN_NOTE,
  sampleLinks,
} from "./posts.testing"
import {
  MAX_LINKS,
  MAX_NAME,
  MAX_POST_TEXT,
  MAX_QUOTE_TEXT,
  assertPostId,
  clipPost,
  communityNoteSchema,
  isoUtc,
  postUrl,
  readAtOf,
  type Quote,
  type RawPost,
} from "./shape"

const COUNTS = { replies: 1, reposts: 2, likes: 3, quotes: 4, bookmarks: 5, views: 6 }

function quote(fields: Partial<Quote> = {}): Quote {
  return {
    id: QUOTE_ID,
    url: postUrl("grace_reads", QUOTE_ID),
    author: { id: "4002", handle: "grace_reads", name: "Grace Reads" },
    created_at: CREATED_AT,
    text: "Quoted words.",
    lang: "en",
    media: [],
    links: [],
    counts: COUNTS,
    sensitive: false,
    ...fields,
  }
}

function raw(fields: Partial<RawPost> = {}): RawPost {
  return {
    ...quote({
      id: POST_ID,
      url: postUrl("ada_writes", POST_ID),
      author: { id: "4001", handle: "ada_writes", name: "Ada" },
    }),
    text: "A short post.",
    reply_to: null,
    quote: null,
    read_at: READ_AT,
    community_note: NO_NOTE,
    ...fields,
  }
}

/** A lone surrogate, which means a pair was split. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe("the clipping limits", () => {
  test("are 2000 characters for a post, 280 for a quote, 50 for a name and 5 links", () => {
    expect([MAX_POST_TEXT, MAX_QUOTE_TEXT, MAX_NAME, MAX_LINKS]).toEqual([2000, 280, 50, 5])
  })
})

describe("clipPost", () => {
  test("changes nothing within the limits and lists nothing as clipped", () => {
    const post = raw({
      text: "x".repeat(MAX_POST_TEXT),
      links: sampleLinks(MAX_LINKS),
      quote: quote({ text: "y".repeat(MAX_QUOTE_TEXT), author: { id: null, handle: "g", name: "n".repeat(MAX_NAME) } }),
    })
    expect(clipPost(post)).toEqual({ ...post, clipped: [] })
  })

  test("clips a post's text to 2000 characters and says so", () => {
    const clipped = clipPost(raw({ text: "x".repeat(MAX_POST_TEXT + 1) }))
    expect(clipped.text).toBe("x".repeat(MAX_POST_TEXT))
    expect(clipped.clipped).toEqual(["text"])
  })

  test("clips a quote's text to 280 characters, not 2000", () => {
    const clipped = clipPost(raw({ quote: quote({ text: "y".repeat(MAX_QUOTE_TEXT + 1) }) }))
    expect(clipped.quote!.text).toBe("y".repeat(MAX_QUOTE_TEXT))
    expect(clipped.clipped).toEqual(["quote.text"])
  })

  test("clips a name to 50 characters, a post's and a quote's", () => {
    const name = "n".repeat(MAX_NAME + 1)
    const clipped = clipPost(
      raw({ author: { id: "1", handle: "a", name }, quote: quote({ author: { id: "2", handle: "g", name } }) }),
    )
    expect(clipped.author).toEqual({ id: "1", handle: "a", name: "n".repeat(MAX_NAME) })
    expect(clipped.quote!.author).toEqual({ id: "2", handle: "g", name: "n".repeat(MAX_NAME) })
    expect(clipped.clipped).toEqual(["author.name", "quote.author.name"])
  })

  test("keeps the first 5 links, a post's and a quote's", () => {
    const clipped = clipPost(raw({ links: sampleLinks(8), quote: quote({ links: sampleLinks(6) }) }))
    expect(clipped.links).toEqual(sampleLinks(MAX_LINKS))
    expect(clipped.quote!.links).toEqual(sampleLinks(MAX_LINKS))
    expect(clipped.clipped).toEqual(["links", "quote.links"])
  })

  test("names every path that was clipped, the post's first", () => {
    const name = "n".repeat(MAX_NAME + 1)
    const clipped = clipPost(
      raw({
        text: "x".repeat(MAX_POST_TEXT + 1),
        author: { id: null, handle: "a", name },
        links: sampleLinks(MAX_LINKS + 1),
        quote: quote({
          text: "y".repeat(MAX_QUOTE_TEXT + 1),
          author: { id: null, handle: "g", name },
          links: sampleLinks(MAX_LINKS + 1),
        }),
      }),
    )
    expect(clipped.clipped).toEqual(["text", "author.name", "links", "quote.text", "quote.author.name", "quote.links"])
  })

  test("clips a community note's text to 2000 characters, whole code points, and says so", () => {
    const note = { status: "shown", text: `a${"😀".repeat(MAX_POST_TEXT)}` } as const
    const clipped = clipPost(raw({ community_note: note }))
    expect(clipped.community_note).toEqual({ status: "shown", text: `a${"😀".repeat(MAX_POST_TEXT - 1)}` })
    expect(clipped.community_note.text).not.toMatch(LONE_SURROGATE)
    expect(clipped.clipped).toEqual(["community_note.text"])
  })

  test("keeps a note within the limit, and a note without a text, as they are", () => {
    const shown = { status: "shown", text: "n".repeat(MAX_POST_TEXT) } as const
    expect(clipPost(raw({ community_note: shown }))).toMatchObject({ community_note: shown, clipped: [] })
    for (const note of [NO_NOTE, UNKNOWN_NOTE]) {
      expect(clipPost(raw({ community_note: note }))).toMatchObject({ community_note: note, clipped: [] })
    }
  })

  test("names a note after the post's own paths and its quote's", () => {
    const clipped = clipPost(
      raw({
        text: "x".repeat(MAX_POST_TEXT + 1),
        quote: quote({ text: "y".repeat(MAX_QUOTE_TEXT + 1) }),
        community_note: { status: "shown", text: "n".repeat(MAX_POST_TEXT + 1) },
      }),
    )
    expect(clipped.clipped).toEqual(["text", "quote.text", "community_note.text"])
  })

  test("leaves everything else as it was, a reply's parent and counts included", () => {
    const replyTo = { id: PARENT_ID, handle: null }
    const clipped = clipPost(raw({ text: "x".repeat(MAX_POST_TEXT + 1), reply_to: replyTo, quote: quote() }))
    expect(clipped.reply_to).toEqual(replyTo)
    expect(clipped.counts).toEqual(COUNTS)
    expect(clipped.quote).toEqual(quote())
  })

  test("counts code points, never splitting a surrogate pair", () => {
    // One unit then pairs: a cut at 2000 units would fall inside a pair.
    const text = `a${"😀".repeat(MAX_POST_TEXT)}`
    const clipped = clipPost(raw({ text }))
    expect(Array.from(clipped.text)).toHaveLength(MAX_POST_TEXT)
    expect(clipped.text).toBe(`a${"😀".repeat(MAX_POST_TEXT - 1)}`)
    expect(clipped.text).not.toMatch(LONE_SURROGATE)
    expect(clipped.clipped).toEqual(["text"])
  })

  test("does not clip a text of pairs that is within the limit in characters but past it in UTF-16 units", () => {
    const text = "😀".repeat(MAX_POST_TEXT)
    expect(text.length).toBe(MAX_POST_TEXT * 2)
    expect(clipPost(raw({ text }))).toMatchObject({ text, clipped: [] })
  })

  test("keeps a name's pairs whole too", () => {
    const clipped = clipPost(raw({ author: { id: null, handle: "a", name: `a${"🙂".repeat(MAX_NAME)}` } }))
    expect(clipped.author.name).toBe(`a${"🙂".repeat(MAX_NAME - 1)}`)
    expect(clipped.author.name).not.toMatch(LONE_SURROGATE)
  })
})

describe("the helpers", () => {
  test("postUrl is the canonical address", () => {
    expect(postUrl("ada_writes", POST_ID)).toBe(`https://x.com/ada_writes/status/${POST_ID}`)
  })

  test("isoUtc writes ISO 8601 in UTC to the second, and null for no time", () => {
    expect(isoUtc(Date.UTC(2026, 0, 7, 10, 30))).toBe("2026-01-07T10:30:00Z")
    expect(isoUtc(Date.UTC(2026, 0, 7, 10, 30, 5, 678))).toBe("2026-01-07T10:30:05Z")
    expect(isoUtc(Number.NaN)).toBeNull()
    expect(isoUtc(8.64e15 + 1)).toBeNull()
  })

  test("readAtOf stamps a moment as isoUtc does, and refuses a clock that gave no time as internal_error", () => {
    expect(readAtOf(READ_AT_MS)).toBe(READ_AT)
    expect(() => readAtOf(Number.NaN)).toThrow(expect.objectContaining({ code: "internal_error" }))
  })

  test("a community note is strict: a status and a text, nothing else", () => {
    expect(communityNoteSchema.safeParse({ status: "shown", text: "Context." }).success).toBe(true)
    expect(communityNoteSchema.safeParse({ status: "none", text: null }).success).toBe(true)
    expect(communityNoteSchema.safeParse({ status: "maybe", text: null }).success).toBe(false)
    expect(communityNoteSchema.safeParse({ status: "none", text: null, extra: 1 }).success).toBe(false)
    expect(communityNoteSchema.safeParse({ status: "none" }).success).toBe(false)
  })

  test("assertPostId takes 1 to 20 decimal digits and refuses the rest as invalid_argument", () => {
    for (const id of ["1", "0", "007", "9".repeat(20)]) expect(() => assertPostId(id)).not.toThrow()
    for (const id of ["", "-1", "1.5", "abc", "1 2", "123\n", "9".repeat(21), "../1", "١٢٣"]) {
      expect(() => assertPostId(id)).toThrow(expect.objectContaining({ code: "invalid_argument" }))
    }
  })
})
