import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { readerPaging } from "../posts/list.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { sourcesFixture, thrown, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { trendFromAccount } from "./account"
import { exploreTrends } from "./explore"
import { MAX_GROUPED, MAX_TREND_NAME, trendReadOutput } from "./schemas"
import { accountTrend, accountTrendsPage, cursorOf, explore } from "./trends.testing"

const READ_AT = "2026-01-01T00:00:00Z"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

describe("a trend from the reading account", () => {
  test("is searched by its name when X gives no query, and its url is that search", () => {
    const trend = trendFromAccount(accountTrend("Bun & Node", { context: "Technology · Trending", rank: 3 }), READ_AT)
    expect(trend).toEqual({
      name: "Bun & Node",
      rank: 3,
      context: "Technology · Trending",
      grouped: [],
      query: "Bun & Node",
      url: "https://x.com/search?q=Bun%20%26%20Node",
      story: false,
      read_at: READ_AT,
      clipped: [],
    })
  })

  test("is searched by X's own query when it gives one", () => {
    const trend = trendFromAccount(accountTrend("Bun", { query: '"Bun" lang:en' }), READ_AT)
    expect(trend).toMatchObject({ query: '"Bun" lang:en', url: "https://x.com/search?q=%22Bun%22%20lang%3Aen" })
  })

  test("is a story with a headline for a name, no query and its own page, when it has a story id", () => {
    const trend = trendFromAccount(accountTrend("A long headline", { story_id: "1234" }), READ_AT)
    expect(trend).toMatchObject({ query: null, url: "https://x.com/i/trending/1234", story: true })
  })

  test("is a story that X gives a query for: it is searched by it", () => {
    const trend = trendFromAccount(accountTrend("Headline", { story_id: "1234", query: "headline" }), READ_AT)
    expect(trend).toMatchObject({ query: "headline", url: "https://x.com/i/trending/1234", story: true })
  })

  test("takes a rank, a context and a query X leaves out or sends as null as not told", () => {
    const trend = trendFromAccount({ name: "Bun", grouped: [] }, READ_AT)
    expect(trend).toMatchObject({ rank: null, context: null, query: "Bun", story: false })
  })

  test("is clipped: the name to its limit, saying so, and the grouped topics to their number and length", () => {
    const grouped = Array.from({ length: MAX_GROUPED + 5 }, (_, i) => `${i}`.padEnd(MAX_TREND_NAME + 10, "x"))
    const trend = trendFromAccount(accountTrend("n".repeat(MAX_TREND_NAME + 1), { grouped }), READ_AT)
    expect(Array.from(trend.name)).toHaveLength(MAX_TREND_NAME)
    expect(trend.clipped).toEqual(["name", "grouped"])
    expect(trend.grouped).toHaveLength(MAX_GROUPED)
    expect(trend.grouped.every((topic) => Array.from(topic).length === MAX_TREND_NAME)).toBe(true)
  })

  test("off the operation's shape is an unexpected reply from the account", () => {
    for (const row of [
      null,
      "Bun",
      { name: 1, grouped: [] },
      { name: "Bun" },
      { name: "Bun", grouped: [], rank: "1" },
    ]) {
      expect(thrown(() => trendFromAccount(row, READ_AT))).toMatchObject(unexpectedMatch("account"))
    }
  })
})

describe("a page of trends from the reading account", () => {
  test("holds at most limit trends, stamped with the time of the read, and the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const data = accountTrendsPage([accountTrend("a"), accountTrend("b"), accountTrend("c")], "ACC2")
    const result = await exploreTrends(explore({ category: "sports", limit: 2 }), readerPaging(h, data))
    expect(result).toMatchObject({
      method: "explore",
      category: "sports",
      source: "account",
      cursor: cursorOf("account", { category: "sports" }, "ACC2"),
    })
    expect(result.trends.map((trend) => [trend.name, trend.read_at])).toEqual([
      ["a", "2026-03-04T05:06:07Z"],
      ["b", "2026-03-04T05:06:07Z"],
    ])
    expect(trendReadOutput.parse(result)).toEqual(result)
  })

  test("ends with a null cursor, and an empty page is a page", async () => {
    const result = await exploreTrends(explore({ category: "news" }), readerPaging(h, accountTrendsPage([])))
    expect(result).toMatchObject({ trends: [], cursor: null, source: "account" })
  })

  test("data off the operation's shape is an unexpected reply from the account", async () => {
    for (const data of [null, {}, { trends: "a" }, { trends: [{ name: 1 }] }]) {
      const error = await rejected(exploreTrends(explore({ category: "news" }), readerPaging(h, data)))
      expect(error).toMatchObject(unexpectedMatch("account"))
    }
  })
})
