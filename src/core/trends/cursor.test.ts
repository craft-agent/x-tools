import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { readerPaging } from "../posts/list.testing"
import { encodeCursor } from "../sources/cursor"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { exploreTrends } from "./explore"
import { accountTrend, accountTrendsPage, cursorOf, explore } from "./trends.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const DATA = accountTrendsPage([accountTrend("a")])

/** The message `read` is refused with, after checking that nothing was read. */
async function refused(read: Promise<unknown>) {
  const error = (await rejected(read)) as Error
  expect(error).toMatchObject({ code: "invalid_argument" })
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error.message
}

describe("a trend cursor", () => {
  test("of one category is refused for another, before any read", async () => {
    const cursor = cursorOf("account", { category: "news" }, "B")
    for (const category of ["sports", "entertainment", "trending"] as const) {
      expect(await refused(exploreTrends(explore({ category, cursor }), readerPaging(h, DATA)))).toContain(
        "other arguments",
      )
    }
    expect(await refused(exploreTrends(explore({ cursor }), readerPaging(h, DATA)))).toContain("other arguments")
  })

  test("of the account continues the same category on the account, sending its own position", async () => {
    const cursor = cursorOf("account", { category: "news" }, "B")
    const result = await exploreTrends(explore({ category: "news", cursor }), readerPaging(h, DATA))
    expect(result).toMatchObject({ source: "account", cursor: null })
    expect(h.accountReads.map(({ args }) => args?.cursor)).toEqual(["B"])
    expect(h.fake.requests).toEqual([])
  })

  test("of the account for trending continues on the account, and FxTwitter is not asked", async () => {
    const cursor = cursorOf("account", { category: "trending" }, "B")
    const result = await exploreTrends(explore({ cursor }), readerPaging(h, DATA))
    expect(result.source).toBe("account")
    expect(h.accountReads.map(({ args }) => args?.cursor)).toEqual(["B"])
    expect(h.fake.requests).toEqual([])
  })

  test("of FxTwitter is refused for the other categories, before any read", async () => {
    const cursor = cursorOf("fxtwitter", { category: "news" }, "B")
    await refused(exploreTrends(explore({ category: "news", cursor }), readerPaging(h, DATA)))
  })

  test("of another read is refused, before any read", async () => {
    const cursor = encodeCursor({ source: "account", read: "community_posts", args: { category: "news" }, cursor: "B" })
    expect(await refused(exploreTrends(explore({ category: "news", cursor }), readerPaging(h, DATA)))).toContain(
      "another read",
    )
  })
})
