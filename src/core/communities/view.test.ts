import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { MAX_NAME } from "../posts/shape"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { MAX_BIO } from "../users/shape"
import { removeTempDirs } from "../x/engine.testing"
import { COMMUNITY_NOT_FOUND_MESSAGE } from "./account"
import { asked, communityData, readerCommunities, view } from "./communities.testing"
import { MAX_RULES, UNTRUSTED_NOTE, communityReadOutput } from "./schemas"
import { viewCommunity } from "./view"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

/** The community `viewCommunity` reads from a bridge that answers `data`. */
async function read(data: unknown) {
  const result = await viewCommunity(view("20"), readerCommunities(h, { community: data }))
  return result.community!
}

describe("community view through the reading account", () => {
  test("asks the bridge's community operation with the id, for an id or a URL alike", async () => {
    for (const community of [" 20 ", "https://x.com/i/communities/20/members?s=1"]) {
      await viewCommunity(view(community), readerCommunities(h, { community: communityData() }))
    }
    expect(asked(h)).toEqual([
      { op: "community", args: { id: "20" } },
      { op: "community", args: { id: "20" } },
    ])
    expect(h.fake.requests).toEqual([])
  })

  test("maps the bridge's fields, with read_at, the URL and the note", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await viewCommunity(view("20"), readerCommunities(h, { community: communityData() }))
    expect(result).toEqual({
      method: "view",
      community: {
        id: "20",
        url: "https://x.com/i/communities/20",
        name: "Typesetters",
        description: "Letters and the people who set them.",
        rules: [{ name: "Be kind", description: "No pile-ons." }],
        member_count: 1234,
        join_policy: "open",
        topic: "Design",
        nsfw: false,
        created_at: "2024-05-06T07:08:09Z",
        is_member: true,
        read_at: "2026-03-04T05:06:07Z",
        clipped: [],
      },
      source: "account",
      note: UNTRUSTED_NOTE,
    })
    expect(communityReadOutput.parse(result)).toEqual(result)
  })

  test("keeps a field the bridge does not tell null, and an empty join policy too", async () => {
    const bare = { id: "20", name: "Typesetters", description: "", rules: [] }
    for (const data of [
      bare,
      communityData({
        member_count: null,
        join_policy: "",
        topic: null,
        nsfw: null,
        created_at: null,
        is_member: null,
        rules: [{ name: "Be kind", description: null }],
      }),
    ]) {
      expect(await read(data)).toMatchObject({
        member_count: null,
        join_policy: null,
        topic: null,
        nsfw: null,
        created_at: null,
        is_member: null,
      })
    }
    expect((await read(communityData({ rules: [{ name: "Be kind", description: null }] }))).rules).toEqual([
      { name: "Be kind", description: null },
    ])
  })

  test("lowercases the join policy", async () => {
    expect((await read(communityData({ join_policy: "Closed" }))).join_policy).toBe("closed")
  })

  test("clips the name and the description, and says so", async () => {
    const community = await read(
      communityData({ name: "n".repeat(MAX_NAME + 1), description: "d".repeat(MAX_BIO + 1) }),
    )
    expect(community.name).toHaveLength(MAX_NAME)
    expect(community.description).toHaveLength(MAX_BIO)
    expect(community.clipped).toEqual(["name", "description"])
  })

  test("clips a rule's name or description, and says rules", async () => {
    const long = { name: "n".repeat(MAX_NAME + 1), description: "d".repeat(MAX_BIO + 1) }
    for (const rule of [
      long,
      { name: "Be kind", description: long.description },
      { name: long.name, description: null },
    ]) {
      const community = await read(communityData({ rules: [rule] }))
      expect(community.name).toBe("Typesetters")
      expect(community.rules[0]!.name.length).toBeLessThanOrEqual(MAX_NAME)
      expect(community.clipped).toEqual(["rules"])
    }
  })

  test("keeps at most the first twenty rules, and says rules", async () => {
    const rules = Array.from({ length: MAX_RULES + 1 }, (_, i) => ({ name: `rule ${i}`, description: null }))
    const community = await read(communityData({ rules }))
    expect(community.rules).toEqual(rules.slice(0, MAX_RULES))
    expect(community.clipped).toEqual(["rules"])
    expect((await read(communityData({ rules: rules.slice(0, MAX_RULES) }))).clipped).toEqual([])
  })

  test("data null is a community X does not give", async () => {
    expect(await rejected(viewCommunity(view("20"), readerCommunities(h, { community: null })))).toMatchObject({
      code: "not_found",
      message: COMMUNITY_NOT_FOUND_MESSAGE,
    })
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    for (const data of [undefined, "none", {}, communityData({ rules: "none" }), communityData({ name: 1 })]) {
      expect(await rejected(viewCommunity(view("20"), readerCommunities(h, { community: data })))).toMatchObject(
        unexpectedMatch("account"),
      )
    }
  })

  test("reads through the account the call names", async () => {
    await h.label("work")
    await viewCommunity(view("20", { account: "work" }), readerCommunities(h, { community: communityData() }))
    expect(h.accountReads.map((request) => request.account)).toEqual(["work"])
  })
})

describe("community view and FxTwitter", () => {
  test("source fxtwitter is refused, with no account read and no FxTwitter request", async () => {
    const read = viewCommunity(
      view("20", { source: "fxtwitter" }),
      readerCommunities(h, { community: communityData() }),
    )
    expect(await rejected(read)).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("does not offer this read"),
    })
    expect(h.accountReads).toEqual([])
    expect(h.fake.requests).toEqual([])
  })

  test("auto and no source read the account and never ask FxTwitter, under account_only as well", async () => {
    for (const options of [undefined, { account_only: true }]) {
      for (const source of [undefined, "auto", "account"] as const) {
        const reader = readerCommunities(h, { community: communityData() }, options)
        expect(await viewCommunity(view("20", { source }), reader)).toMatchObject({ source: "account" })
      }
    }
    expect(h.fake.requests).toEqual([])
  })

  test("under account_only, source fxtwitter is refused naming the setting", async () => {
    const reader = readerCommunities(h, { community: communityData() }, { account_only: true })
    const error = (await rejected(viewCommunity(view("20", { source: "fxtwitter" }), reader))) as Error
    expect(error.message).toContain("account_only")
  })
})
