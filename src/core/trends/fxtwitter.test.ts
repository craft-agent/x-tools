import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { requested } from "../posts/view.testing"
import { sourcesFixture, thrown, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { readTrendsFromFxTwitter, trendFromFxTwitter } from "./fxtwitter"
import { MAX_GROUPED, MAX_TREND_NAME } from "./schemas"
import { fxTrend, routeTrends, trendsPath } from "./trends.testing"

const READ_AT = "2026-01-01T00:00:00Z"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const read = (limit = 20) => readTrendsFromFxTwitter(h.reader().fxtwitter(), { limit, now: () => h.clock.time })

describe("a trend from FxTwitter", () => {
  test("is searched by its name, with no story told, and takes its context and grouped topics as given", () => {
    const trend = trendFromFxTwitter(
      fxTrend("Hokit", { grouped_topics: [{ name: "Hokit Rivera" }, { name: "UFC" }] }),
      READ_AT,
    )
    expect(trend).toEqual({
      name: "Hokit",
      rank: null,
      context: "Sports · Trending",
      grouped: ["Hokit Rivera", "UFC"],
      query: "Hokit",
      url: "https://x.com/search?q=Hokit",
      story: null,
      read_at: READ_AT,
      clipped: [],
    })
  })

  test("reads a rank that is a decimal string or an integer, and no other as not told", () => {
    const rank = (value: unknown) => trendFromFxTwitter(fxTrend("a", { rank: value }), READ_AT).rank
    expect([rank("12"), rank(3), rank("3rd"), rank("1.5"), rank(1.5), rank(null), rank(undefined)]).toEqual([
      12,
      3,
      null,
      null,
      null,
      null,
      null,
    ])
  })

  test("is clipped as the reading account's is", () => {
    const grouped_topics = Array.from({ length: MAX_GROUPED + 1 }, () => ({ name: "t".repeat(MAX_TREND_NAME + 1) }))
    const trend = trendFromFxTwitter(fxTrend("#" + "n".repeat(MAX_TREND_NAME), { grouped_topics }), READ_AT)
    expect(Array.from(trend.name)).toHaveLength(MAX_TREND_NAME)
    expect(trend.clipped).toEqual(["name", "grouped"])
    expect(trend.grouped).toHaveLength(MAX_GROUPED)
  })

  test("off shape is an unexpected reply from FxTwitter", () => {
    for (const row of [null, { rank: null }, { name: 1 }, fxTrend("a", { grouped_topics: [{}] })]) {
      expect(thrown(() => trendFromFxTwitter(row, READ_AT))).toMatchObject(unexpectedMatch("fxtwitter", 200))
    }
  })
})

describe("the trends of FxTwitter", () => {
  test("asks the trending route with count, and never a cursor", async () => {
    routeTrends(h, [fxTrend("a")], 7)
    await read(7)
    expect(requested(h)).toEqual(["/2/trends?type=trending&count=7"])
  })

  test("a 200 with trends is an answer holding at most limit of them and no cursor, whatever the body's", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    routeTrends(h, [fxTrend("a"), fxTrend("b"), fxTrend("c")], 2)
    const outcome = await read(2)
    expect(outcome.kind).toBe("answer")
    expect(outcome.value.cursor).toBeNull()
    expect(outcome.value.items.map((trend) => [trend.name, trend.read_at])).toEqual([
      ["a", "2026-03-04T05:06:07Z"],
      ["b", "2026-03-04T05:06:07Z"],
    ])
  })

  test("a 200 with no trends, and a 404, are a fallback whose value is the empty page", async () => {
    const empty = { kind: "fallback", reason: "empty", value: { items: [], cursor: null } }
    routeTrends(h, [])
    expect(await read()).toMatchObject(empty)
    h.fake.route(trendsPath(), {
      status: 404,
      body: { code: 404, message: "Explore initial timeline not found", trends: [] },
    })
    expect(await read()).toMatchObject(empty)
  })

  test("a 400 and a status it does not know are an unexpected reply from FxTwitter", async () => {
    for (const status of [400, 403]) {
      h.fake.route(trendsPath(), { status, body: { code: status, message: "no" } })
      expect(await rejected(read())).toMatchObject(unexpectedMatch("fxtwitter", status))
    }
  })

  test("a 200 body off shape, or with a row off shape, is an unexpected reply from FxTwitter", async () => {
    for (const body of [{ code: 200 }, { trends: "a" }, { trends: [{ rank: null }] }]) {
      h.fake.route(trendsPath(), { status: 200, body })
      expect(await rejected(read())).toMatchObject(unexpectedMatch("fxtwitter", 200))
    }
  })
})
