import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { accountPost as accountPostAt, readPostFromAccount } from "./account"
import {
  CREATED_AT,
  PARENT_ID,
  POST_ID,
  QUOTE_ID,
  READ_AT,
  UNKNOWN_NOTE,
  accountData,
  sampleLinks,
  unexpectedMatch,
} from "./posts.testing"
import { MAX_LINKS, MAX_POST_TEXT } from "./shape"
import { readerAnswering as readerAnsweringById } from "./view.testing"

const accountPost = (data: unknown) => accountPostAt(data, READ_AT)

const COUNTS = { replies: 2, reposts: 3, likes: 40, quotes: 1, bookmarks: 5, views: 1200 }

const QUOTE_DATA = {
  id: QUOTE_ID,
  date: "2026-01-06T11:46:40+00:00",
  user: { id: "4002", username: "grace_reads", displayname: "Grace Reads" },
  text: "The quoted words.",
}

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

/** A reader whose reading account answers `data` for `POST_ID`; every read is recorded in `h.accountReads`. */
const readerAnswering = (data: unknown) => readerAnsweringById(h, { [POST_ID]: data })

describe("accountPost", () => {
  test("maps the fields of the shape, a missing size and alt text as null", () => {
    const data = accountData({
      media: [
        { type: "photo", url: "https://pbs.example.test/media/photo1.jpg", duration_seconds: null },
        { type: "video", url: "https://video.example.test/high.mp4", duration_seconds: 12.5 },
        { type: "gif", url: "https://video.example.test/loop.mp4", duration_seconds: null },
      ],
      links: ["https://example.test/a"],
      reply_to: { id: PARENT_ID, username: "grace_reads" },
      quote: { ...accountData(QUOTE_DATA), reply_to: null, quote: null },
    })
    expect(accountPost(data)).toEqual({
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
          alt_text: null,
          width: null,
          height: null,
          duration_seconds: null,
        },
        {
          type: "video",
          url: "https://video.example.test/high.mp4",
          alt_text: null,
          width: null,
          height: null,
          duration_seconds: 12.5,
        },
        {
          type: "gif",
          url: "https://video.example.test/loop.mp4",
          alt_text: null,
          width: null,
          height: null,
          duration_seconds: null,
        },
      ],
      links: ["https://example.test/a"],
      counts: COUNTS,
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
        counts: COUNTS,
        sensitive: false,
      },
      read_at: READ_AT,
      community_note: UNKNOWN_NOTE,
      clipped: [],
    })
  })

  test("the community note is unknown: the reading account does not report notes", () => {
    expect(accountPost(accountData()).community_note).toEqual(UNKNOWN_NOTE)
    expect(accountPost(accountData({ community_note: { text: "ignored" } })).community_note).toEqual(UNKNOWN_NOTE)
  })

  test("normalizes the date to UTC with a Z, whatever offset or fraction the bridge wrote", () => {
    for (const date of [
      "2026-01-07T10:30:00+00:00",
      "2026-01-07T19:30:00+09:00",
      "2026-01-07T10:30:00.123456+00:00",
      "2026-01-07T10:30:00Z",
    ]) {
      expect(accountPost(accountData({ date })).created_at).toBe(CREATED_AT)
    }
  })

  test("a date that is no time is null", () => {
    expect(accountPost(accountData({ date: "yesterday" })).created_at).toBeNull()
  })

  test("a count the bridge did not give is null, and 0 stays 0", () => {
    const { counts } = accountPost(accountData({ views: null, bookmarks: undefined, likes: 0 }))
    expect(counts).toMatchObject({ views: null, bookmarks: null, likes: 0 })
  })

  test("a reply whose parent's author is unknown has a null handle", () => {
    const post = accountPost(accountData({ reply_to: { id: PARENT_ID, username: null } }))
    expect(post.reply_to).toEqual({ id: PARENT_ID, handle: null })
  })

  test("missing optional fields are null", () => {
    const { lang: _lang, sensitive: _sensitive, reply_to: _replyTo, quote: _quote, ...bare } = accountData()
    const post = accountPost({ ...bare, user: { username: "ada_writes", displayname: "Ada" } })
    expect(post).toMatchObject({
      author: { id: null, handle: "ada_writes", name: "Ada" },
      lang: null,
      sensitive: null,
      reply_to: null,
      quote: null,
    })
  })

  test("clips as FxTwitter's posts are clipped", () => {
    const post = accountPost(accountData({ text: "x".repeat(MAX_POST_TEXT + 1), links: sampleLinks(MAX_LINKS + 1) }))
    expect(post.text).toHaveLength(MAX_POST_TEXT)
    expect(post.links).toHaveLength(MAX_LINKS)
    expect(post.clipped).toEqual(["text", "links"])
  })

  const BROKEN: Record<string, unknown> = {
    "not an object": "post",
    null: null,
    "a list": [],
    "no id": { ...accountData(), id: undefined },
    "an id that is a number": accountData({ id: 1700000000000000001 }),
    "no date": { ...accountData(), date: undefined },
    "no user": { ...accountData(), user: undefined },
    "a user without a username": accountData({ user: { id: "1", displayname: "Ada" } }),
    "no text": { ...accountData(), text: undefined },
    "a count that is text": accountData({ likes: "40" }),
    "media that is not a list": accountData({ media: "photo" }),
    "a media kind that is unknown": accountData({ media: [{ type: "audio", url: "https://x.test/a" }] }),
    "media without a url": accountData({ media: [{ type: "photo" }] }),
    "links that are not text": accountData({ links: [1] }),
    "no links": { ...accountData(), links: undefined },
    "a quote off shape": accountData({ quote: { ...accountData(QUOTE_DATA), text: 5 } }),
  }
  for (const [name, data] of Object.entries(BROKEN)) {
    test(`${name} is an unexpected_reply`, () => {
      expect(() => accountPost(data)).toThrow(expect.objectContaining(unexpectedMatch("account")))
    })
  }
})

describe("readPostFromAccount", () => {
  test("reads the post operation with the id, and maps what it gives", async () => {
    const lookup = await readPostFromAccount(readerAnswering(accountData()), POST_ID)
    expect(lookup).toMatchObject({ status: "ok", post: { id: POST_ID, created_at: CREATED_AT } })
    expect(h.accountReads).toHaveLength(1)
    expect(h.accountReads[0]).toMatchObject({ op: "post", args: { id: POST_ID }, account: undefined })
  })

  test("stamps the post with the time the reader's clock tells when the bridge answers", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const lookup = await readPostFromAccount(readerAnswering(accountData()), POST_ID)
    expect(lookup).toMatchObject({
      status: "ok",
      post: { read_at: "2026-03-04T05:06:07Z", community_note: UNKNOWN_NOTE },
    })
  })

  test("reads through the label it is given", async () => {
    await readPostFromAccount(readerAnswering(accountData()), POST_ID, "work")
    expect(h.accountReads[0]).toMatchObject({ op: "post", args: { id: POST_ID }, account: "work" })
  })

  test("no tweet is not_found: the reading account cannot tell a missing post from one it may not see", async () => {
    expect(await readPostFromAccount(readerAnswering(null), POST_ID)).toEqual({
      status: "not_found",
      reason: "not_found",
    })
  })

  test("data off shape is an unexpected_reply", async () => {
    for (const data of [{ id: POST_ID }, "post", undefined]) {
      expect(await rejected(readPostFromAccount(readerAnswering(data), POST_ID))).toMatchObject(
        unexpectedMatch("account"),
      )
    }
  })

  test("an id that is not a decimal number is refused without a read", async () => {
    for (const id of ["", "../1", "abc", "1".repeat(21)]) {
      expect(await rejected(readPostFromAccount(readerAnswering(null), id))).toMatchObject({ code: "invalid_argument" })
    }
    expect(h.accountReads).toEqual([])
  })

  test("what the reader throws propagates, and nothing is mapped", async () => {
    const reader = h.reader(undefined, { budgetMs: 1 })
    h.clock.time += 1000
    expect(await rejected(readPostFromAccount(reader, POST_ID))).toMatchObject({
      code: "rate_limited",
      details: { reason: "call_budget" },
    })
    expect(h.accountReads).toEqual([])
  })
})
