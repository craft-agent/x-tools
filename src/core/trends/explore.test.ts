import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { readerPaging } from "../posts/list.testing"
import { requested } from "../posts/view.testing"
import { ACCOUNT_ONLY_MESSAGE } from "../sources/choose"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { exploreTrends } from "./explore"
import { TREND_CATEGORIES } from "./schemas"
import { accountTrend, accountTrendsPage, cursorOf, explore, fxTrend, routeTrends, trendsPath } from "./trends.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ACCOUNT_DATA = accountTrendsPage([accountTrend("from the account")], "ACC")
const names = (result: { trends: { name: string }[] }) => result.trends.map((trend) => trend.name)

describe("trending under auto", () => {
  test("reads FxTwitter first, and its answer stands with no cursor and no account read", async () => {
    await h.label()
    routeTrends(h, [fxTrend("Hokit"), fxTrend("#UFC334")])
    const result = await exploreTrends(explore(), readerPaging(h, ACCOUNT_DATA))
    expect(result).toMatchObject({ category: "trending", source: "fxtwitter", cursor: null })
    expect(names(result)).toEqual(["Hokit", "#UFC334"])
    expect(requested(h)).toEqual([trendsPath()])
    expect(h.accountReads).toEqual([])
  })

  test("falls to the reading account when FxTwitter has no trends, or a 404", async () => {
    await h.label()
    for (const reply of [
      { status: 200, body: { code: 200, trends: [] } },
      { status: 404, body: { code: 404, message: "Explore initial timeline not found", trends: [] } },
    ]) {
      h.fake.route(trendsPath(), reply)
      const result = await exploreTrends(explore(), readerPaging(h, ACCOUNT_DATA))
      expect(result).toMatchObject({ source: "account", cursor: cursorOf("account", { category: "trending" }, "ACC") })
      expect(names(result)).toEqual(["from the account"])
    }
    expect(h.accountReads).toHaveLength(2)
  })

  test("returns the empty page from FxTwitter when no reading account is set up", async () => {
    for (const reply of [
      { status: 200, body: { code: 200, trends: [] } },
      { status: 404, body: { code: 404, trends: [] } },
    ]) {
      h.fake.route(trendsPath(), reply)
      const result = await exploreTrends(explore(), h.reader())
      expect(result).toMatchObject({ trends: [], source: "fxtwitter", cursor: null })
    }
    expect(h.accountReads).toEqual([])
  })

  test("a 400 from FxTwitter is an upstream error, not a fall to the reading account", async () => {
    h.fake.route(trendsPath(), { status: 400, body: { code: 400 } })
    expect(await rejected(exploreTrends(explore(), h.reader()))).toMatchObject({ code: "upstream_error" })
  })
})

describe("trending under the other sources", () => {
  test("source fxtwitter returns the empty page, and never the reading account's", async () => {
    await h.label()
    routeTrends(h, [])
    const result = await exploreTrends(explore({ source: "fxtwitter" }), readerPaging(h, ACCOUNT_DATA))
    expect(result).toMatchObject({ trends: [], source: "fxtwitter", cursor: null })
    expect(h.accountReads).toEqual([])
  })

  test("source account reads only the reading account", async () => {
    await h.label()
    const result = await exploreTrends(explore({ source: "account" }), readerPaging(h, ACCOUNT_DATA))
    expect(result.source).toBe("account")
    expect(h.fake.requests).toEqual([])
  })

  test("under account_only reads the account, and source fxtwitter is refused before any read", async () => {
    await h.label()
    const options = { account_only: true }
    const result = await exploreTrends(explore(), readerPaging(h, ACCOUNT_DATA, options))
    expect(result.source).toBe("account")
    const error = await rejected(
      exploreTrends(explore({ source: "fxtwitter" }), readerPaging(h, ACCOUNT_DATA, options)),
    )
    expect(error).toMatchObject({ code: "invalid_argument", message: ACCOUNT_ONLY_MESSAGE })
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toHaveLength(1)
  })
})

describe("the other categories", () => {
  const OTHERS = TREND_CATEGORIES.slice(1)

  test("read only the reading account under auto, and never request FxTwitter", async () => {
    await h.label()
    for (const category of OTHERS) {
      const result = await exploreTrends(explore({ category }), readerPaging(h, ACCOUNT_DATA))
      expect(result).toMatchObject({ category, source: "account" })
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads.map(({ args }) => args?.category)).toEqual(OTHERS)
  })

  test("refuse source fxtwitter as a read FxTwitter does not offer, before any request", async () => {
    await h.label()
    for (const category of OTHERS) {
      const error = await rejected(
        exploreTrends(explore({ category, source: "fxtwitter" }), readerPaging(h, ACCOUNT_DATA)),
      )
      expect(error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("does not offer") })
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })

  test("under source account without a reading account are not_found, and read nothing", async () => {
    const error = await rejected(exploreTrends(explore({ category: "news", source: "account" }), h.reader()))
    expect(error).toMatchObject({ code: "not_found", message: "No reading account is set up yet." })
    expect(h.fake.requests).toEqual([])
  })
})
