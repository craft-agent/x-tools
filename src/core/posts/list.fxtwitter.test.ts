import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { cursorOf, fxRows, mentions, quotes, quotesPath, routeList, search, searchPath } from "./list.testing"
import { mentionsOfAccount } from "./mentions"
import { quotesOfPost } from "./quotes"
import { UNTRUSTED_NOTE, postReadOutput } from "./schemas"
import { searchPosts } from "./search"
import { NO_NOTE, fxNote, fxTombstone } from "./posts.testing"
import { requested } from "./view.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const QUERY = 'from:ada "slow reading" -filter:replies lang:en'

describe("a page of FxTwitter: what is asked", () => {
  test("search asks /2/search with the query as written, the feed (latest by default) and count 20", async () => {
    const path = searchPath({ q: QUERY, feed: "latest", count: "20" })
    routeList(h, path, fxRows(["31", "32"]), "BOTTOM")
    const result = await searchPosts(search(QUERY), h.reader())
    expect(requested(h)).toEqual([path])
    expect(result).toEqual({
      method: "search",
      query: QUERY,
      source: "fxtwitter",
      results: [
        expect.objectContaining({ id: "31", url: "https://x.com/ada_writes/status/31", community_note: NO_NOTE }),
        expect.objectContaining({ id: "32" }),
      ],
      cursor: cursorOf("fxtwitter", "search", { query: QUERY, feed: "latest" }, "BOTTOM"),
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
    expect(h.accountReads).toEqual([])
  })

  test("search takes the feed and the limit as count, and continues a cursor with FxTwitter's own", async () => {
    const first = searchPath({ q: "x", feed: "top", count: "5" })
    const second = searchPath({ q: "x", feed: "top", count: "5", cursor: "BOTTOM 1/2=" })
    routeList(h, first, fxRows(["31"]), "BOTTOM 1/2=")
    routeList(h, second, fxRows(["32"]), null)
    const page = await searchPosts(search("x", { feed: "top", limit: 5 }), h.reader())
    const next = await searchPosts(search("x", { feed: "top", limit: 5, cursor: page.cursor! }), h.reader())
    expect(requested(h)).toEqual([first, second])
    expect(next.results?.map((post) => post.id)).toEqual(["32"])
    expect(next).toMatchObject({ source: "fxtwitter", cursor: null })
  })

  test("quotes asks /2/status/<id>/quotes with count, for an id or a URL, and reports no query", async () => {
    routeList(h, quotesPath("20"), fxRows(["31"]), "BOTTOM")
    const result = await quotesOfPost(quotes("https://x.com/ada_writes/status/20"), h.reader())
    expect(requested(h)).toEqual([quotesPath("20")])
    expect(result).toMatchObject({
      method: "quotes",
      source: "fxtwitter",
      cursor: cursorOf("fxtwitter", "quotes", { post: "20" }, "BOTTOM"),
    })
    expect(result).not.toHaveProperty("query")

    routeList(h, quotesPath("20", { count: "50", cursor: "BOTTOM" }), fxRows(["32"]))
    await quotesOfPost(quotes("20", { limit: 50, cursor: result.cursor! }), h.reader())
    expect(requested(h).at(-1)).toBe(quotesPath("20", { count: "50", cursor: "BOTTOM" }))
  })

  test("mentions asks the search `@<handle> -from:<handle>` in the latest feed, lowercase, and reports the query", async () => {
    const query = "@ada_writes -from:ada_writes"
    routeList(h, searchPath({ q: query, feed: "latest", count: "20" }), fxRows(["31"]), "BOTTOM")
    const result = await mentionsOfAccount(mentions("@Ada_Writes"), h.reader())
    expect(requested(h)).toEqual([searchPath({ q: query, feed: "latest", count: "20" })])
    expect(result).toMatchObject({
      method: "mentions",
      query,
      source: "fxtwitter",
      cursor: cursorOf("fxtwitter", "mentions", { handle: "ada_writes", since: null }, "BOTTOM"),
    })
  })

  test("mentions adds the day it reads from to the query", async () => {
    const query = "@ada_writes -from:ada_writes since:2026-01-05"
    routeList(h, searchPath({ q: query, feed: "latest", count: "20" }), fxRows(["31"]))
    const result = await mentionsOfAccount(mentions("ada_writes", { since: "2026-01-05" }), h.reader())
    expect(result.query).toBe(query)
    expect(result.cursor).toBeNull()
  })
})

describe("a page of FxTwitter: what comes back", () => {
  const path = searchPath({ q: "x", feed: "latest", count: "20" })

  test("keeps the statuses in order and skips the rows that are none, such as tombstones", async () => {
    routeList(
      h,
      path,
      [fxTombstone("deleted"), ...fxRows(["31"]), { type: "other" }, "stray", ...fxRows(["32"])],
      "BOTTOM",
    )
    const result = await searchPosts(search("x"), h.reader())
    expect(result.results?.map((post) => post.id)).toEqual(["31", "32"])
  })

  test("stamps every post with the time the reply arrived, and the note FxTwitter gives", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    routeList(h, path, [...fxRows(["31"]), { ...(fxRows(["32"])[0] as object), community_note: fxNote("Context.") }])
    const result = await searchPosts(search("x"), h.reader())
    expect(result.results).toEqual([
      expect.objectContaining({ id: "31", read_at: "2026-03-04T05:06:07Z", community_note: NO_NOTE }),
      expect.objectContaining({
        id: "32",
        read_at: "2026-03-04T05:06:07Z",
        community_note: { status: "shown", text: "Context." },
      }),
    ])
  })

  test("keeps at most limit posts when FxTwitter sends more", async () => {
    const limited = searchPath({ q: "x", feed: "latest", count: "2" })
    routeList(h, limited, fxRows(["31", "32", "33", "34"]), "BOTTOM")
    const result = await searchPosts(search("x", { limit: 2 }), h.reader())
    expect(result.results?.map((post) => post.id)).toEqual(["31", "32"])
  })

  test("the cursor is the bottom cursor; a page without rows, or without a usable bottom, has none", async () => {
    const bodies: [string, object, string | null][] = [
      ["no rows", { results: [], cursor: { top: "T", bottom: "BOTTOM" } }, null],
      ["no bottom", { results: fxRows(["31"]), cursor: { top: "T", bottom: null } }, null],
      ["an empty bottom", { results: fxRows(["31"]), cursor: { top: "T", bottom: "" } }, null],
      ["no cursor", { results: fxRows(["31"]) }, null],
      ["a null cursor", { results: fxRows(["31"]), cursor: null }, null],
      ["a cursor of another shape", { results: fxRows(["31"]), cursor: "BOTTOM" }, null],
      ["a bottom", { results: fxRows(["31"]), cursor: { bottom: "BOTTOM" } }, "BOTTOM"],
    ]
    for (const [name, body, bottom] of bodies) {
      h.fake.route(path, { status: 200, body })
      const result = await searchPosts(search("x"), h.reader())
      const expected = bottom && cursorOf("fxtwitter", "search", { query: "x", feed: "latest" }, bottom)
      expect({ name, cursor: result.cursor }).toEqual({ name, cursor: expected ?? null })
    }
  })
})
