import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import {
  communityMembersPage,
  communityPostsPage,
  cursorOf,
  members,
  posts,
  readerCommunities,
} from "./communities.testing"
import { communityMembers } from "./members"
import { communityPosts } from "./posts"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ANSWERS = { community_posts: communityPostsPage(["21"]), community_members: communityMembersPage(["ada"]) }

/** The message `read` is refused with, after checking that nothing was read. */
async function refused(read: Promise<unknown>) {
  const error = (await rejected(read)) as Error
  expect(error).toMatchObject({ code: "invalid_argument" })
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error.message
}

describe("a community cursor", () => {
  test("of the community's posts is refused by members, and the members' by posts, before any read", async () => {
    const postsCursor = cursorOf("account", { community: "20" }, "B", "community_posts")
    const membersCursor = cursorOf("account", { community: "20", order: "relevance" }, "B", "community_members")
    const reader = () => readerCommunities(h, ANSWERS)
    expect(await refused(communityMembers(members("20", { cursor: postsCursor }), reader()))).toContain("another read")
    expect(await refused(communityPosts(posts("20", { cursor: membersCursor }), reader()))).toContain("another read")
  })

  test("of another community is refused before any read", async () => {
    const cursor = cursorOf("account", { community: "21", order: "relevance" }, "B")
    const read = communityPosts(posts("20", { cursor }), readerCommunities(h, ANSWERS))
    expect(await refused(read)).toContain("other arguments")
  })

  test("of FxTwitter is refused before any read", async () => {
    const cursor = cursorOf("fxtwitter", { community: "20", order: "relevance" }, "B")
    await refused(communityPosts(posts("20", { cursor }), readerCommunities(h, ANSWERS)))
    await refused(communityPosts(posts("20", { cursor, source: "account" }), readerCommunities(h, ANSWERS)))
  })

  test("of a relevance read is refused for recency, and a recency cursor for relevance, before any read", async () => {
    const relevance = cursorOf("account", { community: "20", order: "relevance" }, "B")
    const recency = cursorOf("account", { community: "20", order: "recency" }, "B")
    const reader = () => readerCommunities(h, ANSWERS)
    expect(await refused(communityPosts(posts("20", { cursor: relevance, order: "recency" }), reader()))).toContain(
      "other arguments",
    )
    expect(await refused(communityPosts(posts("20", { cursor: recency }), reader()))).toContain("other arguments")
    expect(await refused(communityPosts(posts("20", { cursor: recency, order: "relevance" }), reader()))).toContain(
      "other arguments",
    )
  })

  test("of the default order continues with order left out or relevance, sending the cursor's own position", async () => {
    const cursor = cursorOf("account", { community: "20", order: "relevance" }, "B")
    for (const order of [undefined, "relevance"] as const) {
      await communityPosts(posts("20", { cursor, order }), readerCommunities(h, ANSWERS))
    }
    expect(h.accountReads.map(({ args }) => args?.cursor)).toEqual(["B", "B"])
  })

  test("continues for the same community named by URL", async () => {
    const cursor = cursorOf("account", { community: "20" }, "B", "community_members")
    const result = await communityMembers(
      members("https://x.com/i/communities/20", { cursor }),
      readerCommunities(h, ANSWERS),
    )
    expect(result).toMatchObject({ source: "account", cursor: null })
    expect(h.accountReads.map(({ args }) => args?.cursor)).toEqual(["B"])
  })
})
