import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { LIST_NOT_FOUND_MESSAGE } from "./account"
import { asked, cursorOf, listPostsPage, posts, readerLists } from "./lists.testing"
import { listPosts } from "./posts"
import { UNTRUSTED_NOTE, listReadOutput } from "./schemas"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ARGS = { list: "20" }
const ANSWERS = { list_posts: listPostsPage(["21", "22"], "ACC2") }

describe("list posts through the reading account", () => {
  test("asks the bridge's list_posts operation with the id, the limit as count and the bridge's own cursor", async () => {
    await listPosts(posts("20", { limit: 7 }), readerLists(h, ANSWERS))
    const cursor = cursorOf("account", ARGS, "ACC1")
    await listPosts(posts("https://x.com/i/lists/20/members?s=1", { cursor }), readerLists(h, ANSWERS))
    const args = (count: number, own: string | null) => ({ op: "list_posts", args: { id: "20", count, cursor: own } })
    expect(asked(h)).toEqual([args(7, null), args(20, "ACC1")])
    expect(h.fake.requests).toEqual([])
  })

  test("an id and a URL name the same list", async () => {
    for (const list of [" 20 ", "https://twitter.com/i/lists/20"]) await listPosts(posts(list), readerLists(h, ANSWERS))
    expect(asked(h).map(({ args }) => args?.id)).toEqual(["20", "20"])
  })

  test("returns the bridge's posts in its order, with read_at, an unknown note and the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await listPosts(posts("20"), readerLists(h, ANSWERS))
    expect(result).toEqual({
      method: "posts",
      posts: [
        expect.objectContaining({
          id: "21",
          read_at: "2026-03-04T05:06:07Z",
          community_note: { status: "unknown", text: null },
        }),
        expect.objectContaining({ id: "22", community_note: { status: "unknown", text: null } }),
      ],
      source: "account",
      cursor: cursorOf("account", ARGS, "ACC2"),
      note: UNTRUSTED_NOTE,
    })
    expect(listReadOutput.parse(result)).toEqual(result)
    expect((await listPosts(posts("20", { limit: 1 }), readerLists(h, ANSWERS))).posts).toHaveLength(1)
  })

  test("the last page has no cursor", async () => {
    const result = await listPosts(posts("20"), readerLists(h, { list_posts: listPostsPage(["21"]) }))
    expect(result.cursor).toBeNull()
  })

  test("data null is a list the reading account cannot see", async () => {
    expect(await rejected(listPosts(posts("20"), readerLists(h, { list_posts: null })))).toMatchObject({
      code: "not_found",
      message: LIST_NOT_FOUND_MESSAGE,
    })
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    for (const page of [undefined, "none", { posts: "none" }, { posts: [{ id: "21" }] }]) {
      const read = listPosts(posts("20"), readerLists(h, { list_posts: page }))
      expect(await rejected(read)).toMatchObject(unexpectedMatch("account"))
    }
  })

  test("reads through the account the call names", async () => {
    await h.label("work")
    await listPosts(posts("20", { account: "work" }), readerLists(h, ANSWERS))
    expect(h.accountReads.map((read) => read.account)).toEqual(["work"])
  })
})

describe("list posts and FxTwitter", () => {
  test("source fxtwitter is refused, with no account read and no FxTwitter request", async () => {
    const read = listPosts(posts("20", { source: "fxtwitter" }), readerLists(h, ANSWERS))
    expect(await rejected(read)).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("does not offer this read"),
    })
    expect(h.accountReads).toEqual([])
    expect(h.fake.requests).toEqual([])
  })

  test("auto and no source read the account and never ask FxTwitter", async () => {
    for (const source of [undefined, "auto", "account"] as const) {
      expect(await listPosts(posts("20", { source }), readerLists(h, ANSWERS))).toMatchObject({ source: "account" })
    }
    expect(h.fake.requests).toEqual([])
  })

  test("under account_only nothing changes, and source fxtwitter is refused naming the setting", async () => {
    const reader = () => readerLists(h, ANSWERS, { account_only: true })
    expect(await listPosts(posts("20"), reader())).toMatchObject({ source: "account" })
    const error = (await rejected(listPosts(posts("20", { source: "fxtwitter" }), reader()))) as Error
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(error.message).toContain("account_only")
    expect(h.fake.requests).toEqual([])
  })
})
