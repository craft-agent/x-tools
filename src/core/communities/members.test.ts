import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { COMMUNITY_NOT_FOUND_MESSAGE } from "./account"
import { asked, communityMembersPage, cursorOf, members, readerCommunities } from "./communities.testing"
import { communityMembers } from "./members"
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

const ARGS = { community: "20" }
const ANSWERS = { community_members: communityMembersPage(["ada", "grace"], "ACC2") }

describe("community members through the reading account", () => {
  test("asks the bridge's community_members operation with the id, the limit as count and the bridge's own cursor", async () => {
    await communityMembers(members("20", { limit: 7 }), readerCommunities(h, ANSWERS))
    const cursor = cursorOf("account", ARGS, "ACC1", "community_members")
    await communityMembers(members("https://x.com/i/communities/20", { cursor }), readerCommunities(h, ANSWERS))
    const args = (count: number, own: string | null) => ({
      op: "community_members",
      args: { id: "20", count, cursor: own },
    })
    expect(asked(h)).toEqual([args(7, null), args(20, "ACC1")])
    expect(h.fake.requests).toEqual([])
  })

  test("returns the bridge's users in its order, with read_at and the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await communityMembers(members("20"), readerCommunities(h, ANSWERS))
    expect(result).toEqual({
      method: "members",
      users: [
        expect.objectContaining({ handle: "ada", read_at: "2026-03-04T05:06:07Z" }),
        expect.objectContaining({ handle: "grace" }),
      ],
      source: "account",
      cursor: cursorOf("account", ARGS, "ACC2", "community_members"),
      note: UNTRUSTED_NOTE,
    })
    expect(communityReadOutput.parse(result)).toEqual(result)
    expect((await communityMembers(members("20", { limit: 1 }), readerCommunities(h, ANSWERS))).users).toHaveLength(1)
  })

  test("data null is a community X does not give", async () => {
    const read = communityMembers(members("20"), readerCommunities(h, { community_members: null }))
    expect(await rejected(read)).toMatchObject({ code: "not_found", message: COMMUNITY_NOT_FOUND_MESSAGE })
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    for (const page of [undefined, "none", { users: "none" }, { users: [{ id: "4001" }] }]) {
      const read = communityMembers(members("20"), readerCommunities(h, { community_members: page }))
      expect(await rejected(read)).toMatchObject(unexpectedMatch("account"))
    }
  })

  test("refuses order, which only posts takes, before any read", async () => {
    const read = communityMembers(members("20", { order: "recency" }), readerCommunities(h, ANSWERS))
    expect(await rejected(read)).toMatchObject({ code: "invalid_argument" })
    expect(h.accountReads).toEqual([])
  })
})

describe("community members and FxTwitter", () => {
  test("source fxtwitter is refused before any read or request", async () => {
    const read = communityMembers(members("20", { source: "fxtwitter" }), readerCommunities(h, ANSWERS))
    expect(await rejected(read)).toMatchObject({ code: "invalid_argument" })
    expect(h.accountReads).toEqual([])
    expect(h.fake.requests).toEqual([])
  })

  test("auto reads the account and never asks FxTwitter, under account_only as well", async () => {
    for (const options of [undefined, { account_only: true }]) {
      const result = await communityMembers(members("20"), readerCommunities(h, ANSWERS, options))
      expect(result).toMatchObject({ source: "account" })
    }
    expect(h.fake.requests).toEqual([])
  })
})
