import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { removeTempDirs } from "../x/engine.testing"
import { USER_ID_TTL_MS } from "../x/user-ids"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { cursorOf } from "./list.testing"
import { UNKNOWN_NOTE, unexpectedMatch } from "./posts.testing"
import { UNTRUSTED_NOTE, postReadOutput, TABS } from "./schemas"
import { timelineOfAccount } from "./timeline"
import { accountTimeline, accountUser, readerTimeline, timeline, timelinePath } from "./timeline.testing"

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
const ARGS = { handle: "ada_writes", tab: "posts" }
const ANSWERS = { user: accountUser("4001"), timeline: accountTimeline(["31", "32"], "ACC2") }

/** What the bridge was asked, per read. */
const asked = () => h.accountReads.map(({ op, args }) => ({ op, args }))

describe("a timeline through the reading account: what is asked", () => {
  test("the first read of a handle runs user, then timeline, and remembers the id", async () => {
    const reader = readerTimeline(h, ANSWERS)
    await timelineOfAccount(timeline("@Ada_Writes", ACCOUNT), reader)
    expect(asked()).toEqual([
      { op: "user", args: { handle: "ada_writes" } },
      { op: "timeline", args: { user_id: "4001", tab: "posts", count: 20, cursor: null } },
    ])
    expect(await reader.userId("ada_writes")).toBe("4001")
  })

  test("a handle whose id is remembered takes only the timeline read, for any case of it", async () => {
    await readerTimeline(h, ANSWERS).rememberUserId("ada_writes", "4001")
    const reader = readerTimeline(h, ANSWERS)
    await timelineOfAccount(timeline("ada_writes", ACCOUNT), reader)
    await timelineOfAccount(timeline("@ADA_WRITES", ACCOUNT), reader)
    expect(asked().map(({ op }) => op)).toEqual(["timeline", "timeline"])
  })

  test("a second read of the same handle takes one read; after 7 days it asks X for the id again", async () => {
    const reader = () => readerTimeline(h, ANSWERS)
    await timelineOfAccount(timeline("ada_writes", ACCOUNT), reader())
    await timelineOfAccount(timeline("ada_writes", ACCOUNT), reader())
    h.clock.time += USER_ID_TTL_MS
    await timelineOfAccount(timeline("ada_writes", ACCOUNT), reader())
    expect(asked().map(({ op }) => op)).toEqual(["user", "timeline", "timeline", "user", "timeline"])
  })

  test("sends each tab, the limit as count and the bridge's own cursor", async () => {
    await readerTimeline(h, ANSWERS).rememberUserId("ada_writes", "4001")
    const reader = readerTimeline(h, ANSWERS)
    for (const tab of TABS) await timelineOfAccount(timeline("ada_writes", { ...ACCOUNT, tab, limit: 7 }), reader)
    await timelineOfAccount(timeline("ada_writes", { ...ACCOUNT, tab: "media" }), reader)
    const args = (tab: string, count: number) => ({
      op: "timeline",
      args: { user_id: "4001", tab, count, cursor: null },
    })
    expect(asked()).toEqual([args("posts", 7), args("replies", 7), args("media", 7), args("media", 20)])
  })

  test("continues an account cursor on the account, even under auto, with the cache and the bridge's own cursor", async () => {
    await readerTimeline(h, ANSWERS).rememberUserId("ada_writes", "4001")
    const cursor = cursorOf("account", "timeline", ARGS, "ACC2")
    const result = await timelineOfAccount(timeline("ada_writes", { cursor }), readerTimeline(h, ANSWERS))
    expect(result).toMatchObject({ source: "account", cursor: cursorOf("account", "timeline", ARGS, "ACC2") })
    expect(asked()).toEqual([{ op: "timeline", args: { user_id: "4001", tab: "posts", count: 20, cursor: "ACC2" } }])
    expect(h.fake.requests).toEqual([])
  })

  test("reads through the account the call names, and remembers the id for that account only", async () => {
    await h.label("work")
    const reader = readerTimeline(h, ANSWERS)
    await timelineOfAccount(timeline("ada_writes", { ...ACCOUNT, account: "work" }), reader)
    expect(h.accountReads.map((read) => read.account)).toEqual(["work", "work"])
    expect(await reader.userId("ada_writes", "work")).toBe("4001")
    expect(await reader.userId("ada_writes", "default")).toBeNull()
  })

  test("falls to the account under auto when FxTwitter is down, and the cursor it gives is the account's", async () => {
    h.fake.route(timelinePath("ada_writes"), { status: 503 })
    const result = await timelineOfAccount(timeline("ada_writes"), readerTimeline(h, ANSWERS))
    expect(result).toMatchObject({ source: "account", cursor: cursorOf("account", "timeline", ARGS, "ACC2") })
  })
})

describe("a timeline through the reading account: what comes back", () => {
  test("the posts in the bridge's order with a note that is unknown, and the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await timelineOfAccount(timeline("ada_writes", ACCOUNT), readerTimeline(h, ANSWERS))
    const read = { read_at: "2026-03-04T05:06:07Z", community_note: UNKNOWN_NOTE }
    expect(result).toEqual({
      method: "timeline",
      status: "ok",
      reason: null,
      results: [expect.objectContaining({ id: "31", ...read }), expect.objectContaining({ id: "32", ...read })],
      source: "account",
      cursor: cursorOf("account", "timeline", ARGS, "ACC2"),
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
  })

  test("keeps at most limit posts, and no cursor at the end", async () => {
    const answers = { ...ANSWERS, timeline: accountTimeline(["31", "32", "33"]) }
    const result = await timelineOfAccount(timeline("ada_writes", { ...ACCOUNT, limit: 2 }), readerTimeline(h, answers))
    expect(result.results?.map((post) => post.id)).toEqual(["31", "32"])
    expect(result.cursor).toBeNull()
  })

  test("no user from X is not_found, with no timeline read, no posts and no cursor", async () => {
    const result = await timelineOfAccount(timeline("ada_writes", ACCOUNT), readerTimeline(h, { user: null }))
    expect(result).toEqual({
      method: "timeline",
      status: "not_found",
      reason: "not_found",
      results: [],
      source: "account",
      cursor: null,
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
    expect(asked()).toEqual([{ op: "user", args: { handle: "ada_writes" } }])
    expect(await readerTimeline(h, {}).userId("ada_writes")).toBeNull()
  })

  test("data off an operation's shape is an unexpected reply of the account, and no id is remembered", async () => {
    const badUsers = [undefined, "none", {}, { id: 4001 }, { id: "ada" }, { id: "" }]
    for (const user of badUsers) {
      const error = await rejected(timelineOfAccount(timeline("ada_writes", ACCOUNT), readerTimeline(h, { user })))
      expect(error).toMatchObject(unexpectedMatch("account"))
    }
    expect(await readerTimeline(h, {}).userId("ada_writes")).toBeNull()
    const badPages = [undefined, "none", { posts: "none" }, { posts: [{ id: "31" }] }]
    for (const page of badPages) {
      const reader = readerTimeline(h, { user: accountUser(), timeline: page })
      expect(await rejected(timelineOfAccount(timeline("ada_writes", ACCOUNT), reader))).toMatchObject(
        unexpectedMatch("account"),
      )
    }
  })
})

describe("a timeline cursor that does not hold is refused before any request", () => {
  async function refused(cursor: string, extra: { source?: "fxtwitter" | "account" } = {}, handle = "ada_writes") {
    const reader = readerTimeline(h, ANSWERS)
    const error = (await rejected(timelineOfAccount(timeline(handle, { ...extra, cursor }), reader))) as Error
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
    return error.message
  }

  test("a cursor of another handle or another tab", async () => {
    expect(await refused(cursorOf("fxtwitter", "timeline", { handle: "grace", tab: "posts" }, "B"))).toContain(
      "other arguments",
    )
    expect(await refused(cursorOf("account", "timeline", { handle: "ada_writes", tab: "media" }, "B"))).toContain(
      "other arguments",
    )
  })

  test("the same handle in another case and with its @ continues, and another read's cursor is refused", async () => {
    expect(await refused(cursorOf("fxtwitter", "mentions", { handle: "ada_writes", since: null }, "B"))).toContain(
      "another read",
    )
    await readerTimeline(h, ANSWERS).rememberUserId("ada_writes", "4001")
    const cursor = cursorOf("account", "timeline", ARGS, "ACC2")
    await timelineOfAccount(timeline("@ADA_Writes", { cursor }), readerTimeline(h, ANSWERS))
    expect(asked()).toHaveLength(1)
  })

  test("a cursor of the other source", async () => {
    expect(await refused(cursorOf("account", "timeline", ARGS, "B"), { source: "fxtwitter" })).toContain(
      "the reading account",
    )
    expect(await refused(cursorOf("fxtwitter", "timeline", ARGS, "B"), { source: "account" })).toContain("FxTwitter")
  })
})

describe("a timeline under account_only", () => {
  const ACCOUNT_ONLY = { account_only: true }

  test("reads no FxTwitter, whatever the source asked", async () => {
    for (const source of [undefined, "auto", "account"] as const) {
      const reader = readerTimeline(h, ANSWERS, ACCOUNT_ONLY)
      expect(await timelineOfAccount(timeline("ada_writes", { source }), reader)).toMatchObject({ source: "account" })
    }
    expect(h.fake.requests).toEqual([])
  })

  test("source fxtwitter and a FxTwitter cursor are refused before any request", async () => {
    const reader = () => readerTimeline(h, ANSWERS, ACCOUNT_ONLY)
    const cursor = cursorOf("fxtwitter", "timeline", ARGS, "B")
    for (const args of [timeline("ada_writes", { source: "fxtwitter" }), timeline("ada_writes", { cursor })]) {
      expect(((await rejected(timelineOfAccount(args, reader()))) as Error).message).toContain("account_only")
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })
})
