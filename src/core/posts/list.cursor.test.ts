import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import type { Reader } from "../sources/reader"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import {
  accountPage,
  cursorOf,
  fxRows,
  mentions,
  quotes,
  quotesPath,
  readerPaging,
  routeList,
  search,
  searchPath,
} from "./list.testing"
import { mentionsOfAccount } from "./mentions"
import { quotesOfPost } from "./quotes"
import type { PostMethod, PostReadInput } from "./schemas"
import { searchPosts } from "./search"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const SEARCH_ARGS = { query: "x", feed: "latest" }
const MENTIONS_ARGS = { handle: "ada", since: null }

const READS: Record<PostMethod, (args: PostReadInput, reader: Reader) => Promise<unknown>> = {
  view: async () => undefined,
  search: searchPosts,
  quotes: quotesOfPost,
  mentions: mentionsOfAccount,
  conversation: async () => undefined,
  thread: async () => undefined,
}

/** The error a call with `cursor` fails with, after checking that no request was made to FxTwitter or the reading account. */
async function refusedCursor(call: (reader: Reader) => Promise<unknown>) {
  await h.label()
  const error = await rejected(call(readerPaging(h, accountPage(["31"]))))
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error as Error
}

describe("a cursor continues only the read and the arguments that gave it", () => {
  test("a search cursor with another query or another feed is refused before any request", async () => {
    for (const given of [
      { query: "y", feed: "latest" },
      { query: "x", feed: "top" },
    ]) {
      const cursor = cursorOf("fxtwitter", "search", given, "BOTTOM")
      const error = await refusedCursor((reader) => searchPosts(search("x", { cursor }), reader))
      expect(error.message).toContain("other arguments")
      expect(error).toMatchObject({ code: "invalid_argument" })
    }
  })

  test("a search cursor is refused as a mentions or a quotes cursor, and the reverse", async () => {
    const fromSearch = cursorOf("fxtwitter", "search", SEARCH_ARGS, "BOTTOM")
    const fromMentions = cursorOf("account", "mentions", MENTIONS_ARGS, "ACC2")
    const fromQuotes = cursorOf("fxtwitter", "quotes", { post: "20" }, "BOTTOM")
    const calls: [string, (reader: Reader) => Promise<unknown>][] = [
      ["mentions", (reader) => mentionsOfAccount(mentions("ada", { cursor: fromSearch }), reader)],
      ["quotes", (reader) => quotesOfPost(quotes("20", { cursor: fromSearch }), reader)],
      ["search", (reader) => searchPosts(search("x", { cursor: fromMentions }), reader)],
      ["search", (reader) => searchPosts(search("x", { cursor: fromQuotes }), reader)],
    ]
    for (const [, call] of calls) {
      const error = await refusedCursor(call)
      expect(error.message).toContain("another read")
      expect(error).toMatchObject({ code: "invalid_argument" })
    }
  })

  test("a quotes cursor with another post, and a mentions cursor with another handle or day", async () => {
    const calls: ((reader: Reader) => Promise<unknown>)[] = [
      (reader) => quotesOfPost(quotes("21", { cursor: cursorOf("fxtwitter", "quotes", { post: "20" }, "B") }), reader),
      (reader) =>
        mentionsOfAccount(mentions("grace", { cursor: cursorOf("fxtwitter", "mentions", MENTIONS_ARGS, "B") }), reader),
      (reader) =>
        mentionsOfAccount(
          mentions("ada", { since: "2026-01-05", cursor: cursorOf("fxtwitter", "mentions", MENTIONS_ARGS, "B") }),
          reader,
        ),
    ]
    for (const call of calls) {
      expect((await refusedCursor(call)).message).toContain("other arguments")
    }
  })

  test("a mentions cursor continues for the same handle in any case and with or without its @", async () => {
    const path = searchPath({ q: "@ada -from:ada", feed: "latest", count: "20", cursor: "BOTTOM" })
    routeList(h, path, fxRows(["32"]))
    const cursor = cursorOf("fxtwitter", "mentions", MENTIONS_ARGS, "BOTTOM")
    const result = await mentionsOfAccount(mentions("@ADA", { cursor }), h.reader())
    expect(result.results?.map((post) => post.id)).toEqual(["32"])
  })

  test("a cursor stays with its source: an account cursor under source fxtwitter, and the reverse, are refused", async () => {
    const account = cursorOf("account", "search", SEARCH_ARGS, "ACC2")
    const fxtwitter = cursorOf("fxtwitter", "search", SEARCH_ARGS, "BOTTOM")
    expect(
      (await refusedCursor((r) => searchPosts(search("x", { source: "fxtwitter", cursor: account }), r))).message,
    ).toContain("the reading account")
    expect(
      (await refusedCursor((r) => searchPosts(search("x", { source: "account", cursor: fxtwitter }), r))).message,
    ).toContain("FxTwitter")
  })

  test("a malformed cursor is refused for every method", async () => {
    for (const method of ["search", "quotes", "mentions"] as const) {
      const base = { search: search("x"), quotes: quotes("20"), mentions: mentions("ada") }[method]
      const error = await refusedCursor((reader) => READS[method]({ ...base, cursor: "not a cursor!" }, reader))
      expect(error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("malformed") })
    }
  })
})

describe("the account_only setting and a missing reading account", () => {
  const ACCOUNT_ONLY = { account_only: true }

  test("under account_only no method reads FxTwitter, whatever the source asked", async () => {
    await h.label()
    for (const source of [undefined, "auto", "account"] as const) {
      const reader = readerPaging(h, accountPage(["31"]), ACCOUNT_ONLY)
      for (const [method, args] of [
        ["search", search("x", { source })],
        ["quotes", quotes("20", { source })],
        ["mentions", mentions("ada", { source })],
      ] as const) {
        expect(await READS[method](args, reader)).toMatchObject({ source: "account" })
      }
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toHaveLength(9)
  })

  test("under account_only source fxtwitter and a FxTwitter cursor are refused before any request", async () => {
    await h.label()
    const reader = () => readerPaging(h, accountPage(["31"]), ACCOUNT_ONLY)
    const message = ((await rejected(searchPosts(search("x", { source: "fxtwitter" }), reader()))) as Error).message
    expect(message).toContain("account_only")
    const cursor = cursorOf("fxtwitter", "search", SEARCH_ARGS, "BOTTOM")
    const refused = (await rejected(searchPosts(search("x", { cursor }), reader()))) as Error
    expect(refused.message).toContain("account_only")
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })

  test("source account, or account_only, with no reading account is not_found before anything is read", async () => {
    for (const [source, options] of [
      ["account", undefined],
      [undefined, ACCOUNT_ONLY],
    ] as const) {
      for (const [method, args] of [
        ["search", search("x", { source })],
        ["quotes", quotes("20", { source })],
        ["mentions", mentions("ada", { source })],
      ] as const) {
        const error = await rejected(READS[method](args, h.reader(options)))
        expect(error).toMatchObject({ code: "not_found", message: "No reading account is set up yet." })
      }
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })

  test("an account label that is not set up is refused first, even when FxTwitter would answer", async () => {
    await h.label()
    routeList(h, quotesPath("20"), fxRows(["31"]))
    const reader = readerPaging(h, accountPage([]))
    expect(await rejected(quotesOfPost(quotes("20", { account: "nowhere" }), reader))).toMatchObject({
      code: "not_found",
    })
    expect(h.fake.requests).toEqual([])
  })
})
