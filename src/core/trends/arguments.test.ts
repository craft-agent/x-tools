import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readerPaging } from "../posts/list.testing"
import { MAX_LIMIT } from "../sources/page"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { exploreTrends } from "./explore"
import { TREND_CATEGORIES, trendReadInput } from "./schemas"
import { accountTrendsPage, explore } from "./trends.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

describe("the arguments of explore", () => {
  test("category, limit and cursor are its own, and source and account are shared", async () => {
    await h.label()
    const reader = readerPaging(h, accountTrendsPage([]))
    await exploreTrends(explore({ category: "news", limit: 5, source: "account", account: "default" }), reader)
    expect(h.accountReads.map(({ op, args }) => ({ op, args }))).toEqual([
      { op: "trends", args: { category: "news", count: 5, cursor: null } },
    ])
  })

  test("the category is trending when left out, and is sent to the reading account as such", async () => {
    await h.label()
    await exploreTrends(explore({ source: "account" }), readerPaging(h, accountTrendsPage([])))
    expect(h.accountReads[0]!.args).toMatchObject({ category: "trending", count: 20 })
  })
})

describe("the input schema", () => {
  const parses = (args: Record<string, unknown>) => trendReadInput.strict().safeParse(args).success

  test("every field but method is optional, and the method must be explore", () => {
    expect(parses({ method: "explore" })).toBe(true)
    expect(parses({ method: "view" })).toBe(false)
    expect(parses({})).toBe(false)
  })

  test("bounds the category and the page, and refuses an argument it does not know", () => {
    for (const category of TREND_CATEGORIES) expect(parses({ method: "explore", category })).toBe(true)
    expect(parses({ method: "explore", category: "politics" })).toBe(false)
    for (const limit of [0, MAX_LIMIT + 1, 2.5]) expect(parses({ method: "explore", limit })).toBe(false)
    expect(parses({ method: "explore", limit: MAX_LIMIT, cursor: "c" })).toBe(true)
    expect(parses({ method: "explore", handle: "ada" })).toBe(false)
  })

  test("describes the category, the limit and the cursor", () => {
    const { shape } = trendReadInput
    expect(shape.category.description).toContain("`trending`")
    expect(shape.limit.description).toContain("`explore`")
    expect(shape.cursor.description).toContain("`explore`")
  })
})
