import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { MAX_LIMIT } from "../sources/page"
import type { Reader } from "../sources/reader"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import {
  communityData,
  communityMembersPage,
  communityPostsPage,
  members,
  posts,
  readerCommunities,
  view,
} from "./communities.testing"
import { communityMembers } from "./members"
import { communityPosts } from "./posts"
import { MAX_COMMUNITY_REF_LENGTH, communityReadInput, type CommunityMethod, type CommunityReadInput } from "./schemas"
import { viewCommunity } from "./view"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const HANDLERS: Record<CommunityMethod, (args: CommunityReadInput, reader: Reader) => Promise<unknown>> = {
  view: viewCommunity,
  posts: communityPosts,
  members: communityMembers,
}

const METHODS = Object.keys(HANDLERS) as CommunityMethod[]

/** The error `args` fails with, after checking that nothing was read. */
async function refusal(args: unknown) {
  const error = await rejected(HANDLERS[(args as CommunityReadInput).method](args as CommunityReadInput, h.reader()))
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error
}

describe("a method's required argument", () => {
  for (const method of METHODS) {
    test(`${method} names community when it is left out`, async () => {
      expect(await refusal({ method })).toMatchObject({
        code: "invalid_argument",
        message: `community is required by ${method}.`,
      })
    })
  }

  test("a community that is no community is refused without echoing it", async () => {
    for (const method of METHODS) {
      for (const community of ["SECRET", "https://example.test/i/communities/20?SECRET", "12a", "1".repeat(21)]) {
        const error = (await refusal({ method, community })) as Error
        expect(error.message).not.toContain("SECRET")
        expect(error).toMatchObject({
          code: "invalid_argument",
          message: "community is not a community id or a community URL on x.com or twitter.com.",
        })
      }
    }
  })
})

describe("the arguments a method does not take", () => {
  test("order belongs to posts alone", async () => {
    for (const method of ["view", "members"] as const) {
      expect(await refusal({ method, community: "20", order: "recency" })).toMatchObject({ code: "invalid_argument" })
    }
  })

  test("limit and cursor belong to posts and members, not to view", async () => {
    for (const extra of [{ limit: 5 }, { cursor: "c" }]) {
      expect(await refusal({ method: "view", community: "20", ...extra })).toMatchObject({ code: "invalid_argument" })
    }
  })

  test("source and account belong to every method", async () => {
    await h.label()
    const reader = readerCommunities(h, {
      community: communityData(),
      community_posts: communityPostsPage([]),
      community_members: communityMembersPage([]),
    })
    const shared = { source: "account", account: "default" } as const
    await viewCommunity(view("20", shared), reader)
    await communityPosts(posts("20", { ...shared, order: "recency", limit: 5 }), reader)
    await communityMembers(members("20", { ...shared, limit: 5 }), reader)
    expect(h.accountReads.map(({ op }) => op)).toEqual(["community", "community_posts", "community_members"])
  })
})

describe("the input schema", () => {
  const parses = (args: Record<string, unknown>) => communityReadInput.strict().safeParse(args).success

  test("every field but method is optional, and the method must be one of three", () => {
    for (const method of METHODS) expect(parses({ method })).toBe(true)
    expect(parses({ method: "likes" })).toBe(false)
    expect(parses({})).toBe(false)
  })

  test("bounds the community, the order and the page, and refuses an argument it does not know", () => {
    for (const method of METHODS) {
      expect(parses({ method, community: "1".repeat(MAX_COMMUNITY_REF_LENGTH) })).toBe(true)
      expect(parses({ method, community: "1".repeat(MAX_COMMUNITY_REF_LENGTH + 1) })).toBe(false)
      for (const limit of [0, MAX_LIMIT + 1, 2.5]) expect(parses({ method, limit })).toBe(false)
      expect(parses({ method, limit: MAX_LIMIT, cursor: "c" })).toBe(true)
      expect(parses({ method, handle: "ada" })).toBe(false)
    }
    for (const order of ["relevance", "recency"]) expect(parses({ method: "posts", order })).toBe(true)
    expect(parses({ method: "posts", order: "top" })).toBe(false)
  })

  test("describes the community, the order, the limit and the cursor", () => {
    const { shape } = communityReadInput
    expect(shape.community.description).toContain("x.com/i/communities/<id>")
    expect(shape.order.description).toContain("recency")
    expect(shape.limit.description).toContain("`posts` and `members`")
    expect(shape.cursor.description).toContain("`posts` and `members`")
  })
})
