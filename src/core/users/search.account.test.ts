import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { ToolError } from "../errors"
import { cursorOf as postCursorOf, fxListReply } from "../posts/list.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { UNTRUSTED_NOTE, userReadOutput } from "./schemas"
import { searchUsers } from "./search"
import {
  accountProfile,
  accountUsersPage,
  cursorOf,
  firstSearchPath,
  fxProfileRows,
  readerUsers,
  search,
} from "./users.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ACCOUNT = { source: "account" } as const
const ARGS = { query: "slow reading" }
const ANSWERS = { user_search: accountUsersPage(["ada", "grace"], "ACC2") }

/** What the bridge was asked, per read. */
const asked = () => h.accountReads.map(({ op, args }) => ({ op, args }))

describe("a search of users through the reading account", () => {
  test("asks the bridge's user_search operation with the query, the limit as count and the bridge's own cursor", async () => {
    await searchUsers(search("slow reading", { ...ACCOUNT, limit: 7 }), readerUsers(h, ANSWERS))
    await searchUsers(search("slow reading", ACCOUNT), readerUsers(h, ANSWERS))
    const args = (count: number) => ({ op: "user_search", args: { query: "slow reading", count, cursor: null } })
    expect(asked()).toEqual([args(7), args(20)])
  })

  test("returns the bridge's users in its order, at most limit, with the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await searchUsers(search("slow reading", ACCOUNT), readerUsers(h, ANSWERS))
    expect(result).toEqual({
      method: "search",
      results: [
        expect.objectContaining({ handle: "ada", read_at: "2026-03-04T05:06:07Z" }),
        expect.objectContaining({ handle: "grace" }),
      ],
      source: "account",
      cursor: cursorOf("account", ARGS, "ACC2"),
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    const one = await searchUsers(search("slow reading", { ...ACCOUNT, limit: 1 }), readerUsers(h, ANSWERS))
    expect(one.results).toHaveLength(1)
    const last = { user_search: accountUsersPage(["ada"]) }
    expect((await searchUsers(search("slow reading", ACCOUNT), readerUsers(h, last))).cursor).toBeNull()
  })

  test("reads through the account the call names", async () => {
    await h.label("work")
    await searchUsers(search("slow reading", { ...ACCOUNT, account: "work" }), readerUsers(h, ANSWERS))
    expect(h.accountReads.map((read) => read.account)).toEqual(["work"])
  })

  test("falls to the account under auto when FxTwitter is down, and the cursor it gives is the account's", async () => {
    h.fake.route(firstSearchPath("slow reading"), { status: 503 })
    const result = await searchUsers(search("slow reading"), readerUsers(h, ANSWERS))
    expect(result).toMatchObject({ source: "account", cursor: cursorOf("account", ARGS, "ACC2") })
  })

  test("a search X refuses is surfaced as forbidden with search_refused, not an empty page", async () => {
    const refusal = new ToolError("forbidden", "X refuses search.", { details: { reason: "search_refused" } })
    const reader = h.reader(undefined, {
      readAccount: async () => {
        throw refusal
      },
    })
    expect(await rejected(searchUsers(search("slow reading", ACCOUNT), reader))).toMatchObject({
      code: "forbidden",
      details: { reason: "search_refused" },
    })
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    const bad = [
      undefined,
      "none",
      { users: "none" },
      { users: [{ id: "4001" }] },
      { users: [accountProfile()], cursor: 5 },
    ]
    for (const user_search of bad) {
      const reader = readerUsers(h, { user_search })
      expect(await rejected(searchUsers(search("slow reading", ACCOUNT), reader))).toMatchObject(
        unexpectedMatch("account"),
      )
    }
  })
})

describe("a user search cursor", () => {
  async function refused(cursor: string, extra: { source?: "fxtwitter" | "account" } = {}, query = "slow reading") {
    const error = (await rejected(searchUsers(search(query, { ...extra, cursor }), readerUsers(h, ANSWERS)))) as Error
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
    return error.message
  }

  test("continues on the account, even under auto, with the bridge's own cursor and no FxTwitter request", async () => {
    const cursor = cursorOf("account", ARGS, "ACC1")
    const result = await searchUsers(search("slow reading", { cursor }), readerUsers(h, ANSWERS))
    expect(result).toMatchObject({ source: "account", cursor: cursorOf("account", ARGS, "ACC2") })
    expect(asked()).toEqual([{ op: "user_search", args: { query: "slow reading", count: 20, cursor: "ACC1" } }])
    expect(h.fake.requests).toEqual([])
  })

  test("of a search of posts with the same query is refused before any request", async () => {
    expect(
      await refused(postCursorOf("fxtwitter", "search", { query: "slow reading", feed: "latest" }, "B")),
    ).toContain("another read")
    expect(await refused(postCursorOf("account", "search", { query: "slow reading", feed: "latest" }, "B"))).toContain(
      "another read",
    )
  })

  test("of another query or the other source is refused before any request", async () => {
    expect(await refused(cursorOf("fxtwitter", { query: "other" }, "B"))).toContain("other arguments")
    expect(await refused(cursorOf("account", ARGS, "B"), { source: "fxtwitter" })).toContain("the reading account")
    expect(await refused(cursorOf("fxtwitter", ARGS, "B"), { source: "account" })).toContain("FxTwitter")
  })
})

describe("a search of users under account_only", () => {
  const ACCOUNT_ONLY = { account_only: true }

  test("reads no FxTwitter, whatever the source asked", async () => {
    for (const source of [undefined, "auto", "account"] as const) {
      const reader = readerUsers(h, ANSWERS, ACCOUNT_ONLY)
      expect(await searchUsers(search("slow reading", { source }), reader)).toMatchObject({ source: "account" })
    }
    expect(h.fake.requests).toEqual([])
  })

  test("source fxtwitter and a FxTwitter cursor are refused before any request", async () => {
    const reader = () => readerUsers(h, ANSWERS, ACCOUNT_ONLY)
    const cursor = cursorOf("fxtwitter", ARGS, "B")
    for (const args of [search("slow reading", { source: "fxtwitter" }), search("slow reading", { cursor })]) {
      expect(((await rejected(searchUsers(args, reader()))) as Error).message).toContain("account_only")
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })
})

describe("a search of users that FxTwitter answers", () => {
  test("does not read the reading account, and its cursor continues on FxTwitter even with an account set up", async () => {
    h.fake.route(firstSearchPath("slow reading"), fxListReply(fxProfileRows(["ada"]), "BOTTOM"))
    const result = await searchUsers(search("slow reading"), readerUsers(h, ANSWERS))
    expect(result.source).toBe("fxtwitter")
    expect(h.accountReads).toEqual([])
  })
})
