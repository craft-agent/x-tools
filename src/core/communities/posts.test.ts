import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { COMMUNITY_NOT_FOUND_MESSAGE } from "./account"
import { asked, communityPostsPage, cursorOf, posts, readerCommunities } from "./communities.testing"
import { communityPosts } from "./posts"
import { UNTRUSTED_NOTE, communityReadOutput } from "./schemas"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ARGS = { community: "20", order: "relevance" }
const ANSWERS = { community_posts: communityPostsPage(["21", "22"], "ACC2") }

describe("community posts through the reading account", () => {
  test("asks the bridge's community_posts operation with the id, the ranking, the limit as count and the bridge's own cursor", async () => {
    await communityPosts(posts("20", { limit: 7 }), readerCommunities(h, ANSWERS))
    const cursor = cursorOf("account", ARGS, "ACC1")
    await communityPosts(posts("https://x.com/i/communities/20/?s=1", { cursor }), readerCommunities(h, ANSWERS))
    const args = (count: number, own: string | null) => ({
      op: "community_posts",
      args: { id: "20", ranking: "Relevance", count, cursor: own },
    })
    expect(asked(h)).toEqual([args(7, null), args(20, "ACC1")])
    expect(h.fake.requests).toEqual([])
  })

  test("order picks the ranking: relevance by default and by name, recency as Recency", async () => {
    for (const order of [undefined, "relevance", "recency"] as const) {
      await communityPosts(posts("20", { order }), readerCommunities(h, ANSWERS))
    }
    expect(asked(h).map(({ args }) => args?.ranking)).toEqual(["Relevance", "Relevance", "Recency"])
  })

  test("returns the bridge's posts in its order, with read_at, an unknown note and the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await communityPosts(posts("20"), readerCommunities(h, ANSWERS))
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
    expect(communityReadOutput.parse(result)).toEqual(result)
    expect((await communityPosts(posts("20", { limit: 1 }), readerCommunities(h, ANSWERS))).posts).toHaveLength(1)
  })

  test("the cursor of a recency read carries its order", async () => {
    const result = await communityPosts(posts("20", { order: "recency" }), readerCommunities(h, ANSWERS))
    expect(result.cursor).toBe(cursorOf("account", { community: "20", order: "recency" }, "ACC2"))
  })

  test("the last page has no cursor", async () => {
    const result = await communityPosts(
      posts("20"),
      readerCommunities(h, { community_posts: communityPostsPage(["21"]) }),
    )
    expect(result.cursor).toBeNull()
  })

  test("data null is a community X does not give", async () => {
    const read = communityPosts(posts("20"), readerCommunities(h, { community_posts: null }))
    expect(await rejected(read)).toMatchObject({ code: "not_found", message: COMMUNITY_NOT_FOUND_MESSAGE })
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    for (const page of [undefined, "none", { posts: "none" }, { posts: [{ id: "21" }] }]) {
      const read = communityPosts(posts("20"), readerCommunities(h, { community_posts: page }))
      expect(await rejected(read)).toMatchObject(unexpectedMatch("account"))
    }
  })

  test("reads through the account the call names", async () => {
    await h.label("work")
    await communityPosts(posts("20", { account: "work" }), readerCommunities(h, ANSWERS))
    expect(h.accountReads.map((read) => read.account)).toEqual(["work"])
  })
})

describe("community posts and FxTwitter", () => {
  test("source fxtwitter is refused, with no account read and no FxTwitter request", async () => {
    const read = communityPosts(posts("20", { source: "fxtwitter" }), readerCommunities(h, ANSWERS))
    expect(await rejected(read)).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("does not offer this read"),
    })
    expect(h.accountReads).toEqual([])
    expect(h.fake.requests).toEqual([])
  })

  test("auto reads the account and never asks FxTwitter, under account_only as well", async () => {
    for (const options of [undefined, { account_only: true }]) {
      const result = await communityPosts(posts("20"), readerCommunities(h, ANSWERS, options))
      expect(result).toMatchObject({ source: "account" })
    }
    expect(h.fake.requests).toEqual([])
  })
})
