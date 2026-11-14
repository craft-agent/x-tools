import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { accountPage, cursorOf, mentions, quotes, readerPaging, search, searchPath } from "./list.testing"
import { mentionsOfAccount } from "./mentions"
import { UNKNOWN_NOTE, unexpectedMatch } from "./posts.testing"
import { quotesOfPost } from "./quotes"
import { UNTRUSTED_NOTE, postReadOutput } from "./schemas"
import { searchPosts } from "./search"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ACCOUNT = { source: "account" } as const

/** What the bridge's `search` operation was asked, per read. */
const asked = () => h.accountReads.map(({ op, args }) => ({ op, args }))

describe("a page of the reading account: what is asked", () => {
  test("search runs the bridge's search with the query as written, the feed's product, count and no cursor", async () => {
    const reader = readerPaging(h, accountPage(["31"]))
    for (const [feed, product] of [
      [undefined, "Latest"],
      ["latest", "Latest"],
      ["top", "Top"],
      ["media", "Media"],
    ] as const) {
      await searchPosts(search('from:ada "slow reading"', { ...ACCOUNT, feed }), reader)
      expect(asked().at(-1)).toEqual({
        op: "search",
        args: { query: 'from:ada "slow reading"', product, count: 20, cursor: null },
      })
    }
  })

  test("quotes searches quoted_tweet_id:<id> in the latest feed, mentions the built query in the latest feed", async () => {
    const reader = readerPaging(h, accountPage([]))
    await quotesOfPost(quotes("https://x.com/ada_writes/status/20", { ...ACCOUNT, limit: 7 }), reader)
    await mentionsOfAccount(mentions("@Ada", { ...ACCOUNT, since: "2026-01-05", limit: 50 }), reader)
    await mentionsOfAccount(mentions("ada", ACCOUNT), reader)
    expect(asked()).toEqual([
      { op: "search", args: { query: "quoted_tweet_id:20", product: "Latest", count: 7, cursor: null } },
      { op: "search", args: { query: "@ada -from:ada since:2026-01-05", product: "Latest", count: 50, cursor: null } },
      { op: "search", args: { query: "@ada -from:ada", product: "Latest", count: 20, cursor: null } },
    ])
  })

  test("reads through the account the call names", async () => {
    await h.label("work")
    await searchPosts(search("x", { ...ACCOUNT, account: "work" }), readerPaging(h, accountPage([])))
    expect(h.accountReads[0]!.account).toBe("work")
  })
})

describe("a page of the reading account: what comes back", () => {
  test("posts in the bridge's order, a note that is unknown, and the account's cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await searchPosts(search("x", ACCOUNT), readerPaging(h, accountPage(["33", "31"], "ACC2")))
    expect(result).toEqual({
      method: "search",
      query: "x",
      source: "account",
      results: [
        expect.objectContaining({ id: "33", read_at: "2026-03-04T05:06:07Z", community_note: UNKNOWN_NOTE }),
        expect.objectContaining({ id: "31", read_at: "2026-03-04T05:06:07Z", community_note: UNKNOWN_NOTE }),
      ],
      cursor: cursorOf("account", "search", { query: "x", feed: "latest" }, "ACC2"),
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
  })

  test("no cursor at the end, whether the bridge says null, leaves it out or gives an empty one", async () => {
    for (const cursor of [null, undefined, ""]) {
      const data = { posts: accountPage(["31"]).posts, cursor }
      expect(await quotesOfPost(quotes("20", ACCOUNT), readerPaging(h, data))).toMatchObject({ cursor: null })
    }
  })

  test("keeps at most limit posts when the bridge gives more", async () => {
    const result = await searchPosts(
      search("x", { ...ACCOUNT, limit: 2 }),
      readerPaging(h, accountPage(["31", "32", "33", "34"], "ACC2")),
    )
    expect(result.results?.map((post) => post.id)).toEqual(["31", "32"])
  })

  test("continues an account cursor on the account, even under auto, and passes the bridge its own cursor", async () => {
    const cursor = cursorOf("account", "search", { query: "x", feed: "latest" }, "ACC2")
    const result = await searchPosts(search("x", { cursor }), readerPaging(h, accountPage(["34"])))
    expect(result).toMatchObject({ source: "account", cursor: null })
    expect(asked()).toEqual([{ op: "search", args: { query: "x", product: "Latest", count: 20, cursor: "ACC2" } }])
    expect(h.fake.requests).toEqual([])
  })

  test("falls to the account under auto when FxTwitter is down, and the cursor it gives is the account's", async () => {
    h.fake.route(searchPath({ q: "x", feed: "latest", count: "20" }), { status: 503 })
    const result = await searchPosts(search("x"), readerPaging(h, accountPage(["31"], "ACC2")))
    expect(result).toMatchObject({
      source: "account",
      cursor: cursorOf("account", "search", { query: "x", feed: "latest" }, "ACC2"),
    })
  })
})

describe("a page of the reading account: it fails", () => {
  test("a search X refuses an account without a verified phone is forbidden, and propagates under every source", async () => {
    const refused = new ToolError("forbidden", "X refused this reading account a search.", {
      details: { reason: "search_refused" },
    })
    const reader = () =>
      readerPaging(h, undefined, undefined, {
        readAccount: async () => {
          throw refused
        },
      })
    h.fake.route(searchPath({ q: "x", feed: "latest", count: "20" }), { status: 503 })
    for (const source of ["account", "auto"] as const) {
      expect(await rejected(searchPosts(search("x", { source }), reader()))).toBe(refused)
    }
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    for (const data of [null, "none", { posts: "none" }, { posts: [{ id: "31" }] }, { posts: [], cursor: 5 }]) {
      const error = await rejected(searchPosts(search("x", ACCOUNT), readerPaging(h, data)))
      expect(error).toMatchObject(unexpectedMatch("account"))
    }
  })
})
