import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { accountPage, mentions, quotes, quotesPath, readerPaging, search, searchPath } from "./list.testing"
import { mentionsOfAccount } from "./mentions"
import { unexpectedMatch } from "./posts.testing"
import { quotesOfPost } from "./quotes"
import { searchPosts } from "./search"
import { requested } from "./view.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const PATH = searchPath({ q: "x", feed: "latest", count: "20" })

describe("a page of FxTwitter: nothing there", () => {
  test("a 404 is an empty page with no cursor, for every method, and the reading account is not asked", async () => {
    await h.label()
    h.fake.route(PATH, { status: 404, body: { code: 404, message: "NOT_FOUND" } })
    h.fake.route(quotesPath("20"), { status: 404 })
    h.fake.route(searchPath({ q: "@ada -from:ada", feed: "latest", count: "20" }), { status: 404, body: {} })
    const reader = readerPaging(h, accountPage(["31"]))
    for (const result of [
      await searchPosts(search("x"), reader),
      await quotesOfPost(quotes("20"), reader),
      await mentionsOfAccount(mentions("ada"), reader),
    ]) {
      expect(result).toMatchObject({ source: "fxtwitter", results: [], cursor: null })
    }
    expect(h.accountReads).toEqual([])
  })
})

describe("a page of FxTwitter: a query it refuses", () => {
  test("a 400 is invalid_argument with FxTwitter's words clipped, and not a failure of FxTwitter", async () => {
    await h.label()
    const long = "y".repeat(300)
    h.fake.route(PATH, { status: 400, body: { code: 400, message: `Bad query: ${long}.` } })
    const error = (await rejected(searchPosts(search("x"), readerPaging(h, accountPage(["31"]))))) as Error
    expect(error.message).toBe(`FxTwitter refused the query: ${`Bad query: ${long}`.slice(0, 200)}.`)
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect((error as { details?: { source?: unknown } }).details?.source).toBeUndefined()
    expect(h.accountReads).toEqual([])
    expect(requested(h)).toEqual([PATH])
  })

  test("reads its words from message or error, and says only that it refused when there are none", async () => {
    const reader = h.reader()
    h.fake.route(PATH, { status: 400, body: { error: "unsupported operator" } })
    expect(((await rejected(searchPosts(search("x"), reader))) as Error).message).toBe(
      "FxTwitter refused the query: unsupported operator.",
    )
    for (const reply of [{ status: 400 }, { status: 400, body: {} }, { status: 400, body: { message: "" } }]) {
      h.fake.route(PATH, reply)
      const error = await rejected(searchPosts(search("x"), reader))
      expect((error as Error).message).toBe("FxTwitter refused the query.")
    }
  })

  test("is final under source fxtwitter too", async () => {
    h.fake.route(PATH, { status: 400, body: { message: "no" } })
    expect(await rejected(searchPosts(search("x", { source: "fxtwitter" }), h.reader()))).toMatchObject({
      code: "invalid_argument",
    })
  })
})

describe("a page of FxTwitter: it fails", () => {
  test("a 5xx falls to the reading account under auto, which answers from its own cursor", async () => {
    await h.label()
    h.fake.route(PATH, { status: 503 })
    const result = await searchPosts(search("x"), readerPaging(h, accountPage(["31"], "ACC2")))
    expect(result).toMatchObject({ source: "account", results: [expect.objectContaining({ id: "31" })] })
    expect(h.accountReads).toHaveLength(1)
  })

  test("a reply off shape falls to the reading account under auto: a status, a body, a row", async () => {
    await h.label()
    const replies = [
      { status: 418, body: {} },
      { status: 200, body: { results: "none" } },
      { status: 200, body: [] },
      { status: 200, body: { results: [{ type: "status", id: 5 }] } },
    ]
    for (const reply of replies) {
      h.fake.route(PATH, reply)
      const result = await searchPosts(search("x"), readerPaging(h, accountPage(["31"])))
      expect(result.source).toBe("account")
    }
    expect(h.accountReads).toHaveLength(replies.length)
  })

  test("without a reading account the failure stands, with the status when FxTwitter gave one", async () => {
    h.fake.route(PATH, { status: 503 })
    expect(await rejected(searchPosts(search("x"), h.reader()))).toMatchObject({
      code: "upstream_error",
      details: { source: "fxtwitter", reason: "server_error" },
    })
    h.fake.route(PATH, { status: 418, body: {} })
    expect(await rejected(searchPosts(search("x"), h.reader()))).toMatchObject(unexpectedMatch("fxtwitter", 418))
    h.fake.route(PATH, { status: 200, body: { results: "none" } })
    expect(await rejected(searchPosts(search("x"), h.reader()))).toMatchObject(unexpectedMatch("fxtwitter", 200))
  })

  test("under source fxtwitter a failure is not taken to the reading account", async () => {
    await h.label()
    h.fake.route(PATH, { status: 503 })
    const error = await rejected(searchPosts(search("x", { source: "fxtwitter" }), readerPaging(h, accountPage([]))))
    expect(error).toMatchObject({ code: "upstream_error", details: { source: "fxtwitter" } })
    expect(h.accountReads).toEqual([])
  })
})
