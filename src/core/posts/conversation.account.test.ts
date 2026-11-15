import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import type { Reader } from "../sources/reader"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { conversationOfPost } from "./conversation"
import {
  accountConversation,
  accountThread,
  conversation,
  conversationPath,
  postIds,
  thread,
} from "./conversation.testing"
import { cursorOf, readerPaging } from "./list.testing"
import { UNKNOWN_NOTE, unexpectedMatch } from "./posts.testing"
import { UNTRUSTED_NOTE, postReadOutput } from "./schemas"
import { threadOfPost } from "./thread"

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
const ARGS = { post: "20", sort: "top" }

/** What the bridge was asked, per read. */
const asked = () => h.accountReads.map(({ op, args }) => ({ op, args }))

describe("a conversation through the reading account: what is asked", () => {
  test("runs the bridge's conversation with the id, the ranking of the sort and no cursor", async () => {
    const reader = readerPaging(h, accountConversation("20"))
    await conversationOfPost(conversation("https://x.com/ada_writes/status/20", ACCOUNT), reader)
    await conversationOfPost(conversation("20", { ...ACCOUNT, sort: "top" }), reader)
    await conversationOfPost(conversation("20", { ...ACCOUNT, sort: "latest" }), reader)
    expect(asked()).toEqual([
      { op: "conversation", args: { id: "20", ranking: "Likes", cursor: null } },
      { op: "conversation", args: { id: "20", ranking: "Likes", cursor: null } },
      { op: "conversation", args: { id: "20", ranking: "Recency", cursor: null } },
    ])
  })

  test("continues an account cursor on the account, even under auto, with the bridge's own cursor", async () => {
    const cursor = cursorOf("account", "conversation", ARGS, "ACC2")
    const result = await conversationOfPost(conversation("20", { cursor }), readerPaging(h, accountConversation("20")))
    expect(result).toMatchObject({ source: "account", cursor: null })
    expect(asked()).toEqual([{ op: "conversation", args: { id: "20", ranking: "Likes", cursor: "ACC2" } }])
    expect(h.fake.requests).toEqual([])
  })

  test("reads through the account the call names", async () => {
    await h.label("work")
    await conversationOfPost(
      conversation("20", { ...ACCOUNT, account: "work" }),
      readerPaging(h, accountConversation("20")),
    )
    expect(h.accountReads[0]!.account).toBe("work")
  })

  test("falls to the account under auto when FxTwitter is down, and the cursor it gives is the account's", async () => {
    h.fake.route(conversationPath("20"), { status: 503 })
    const data = accountConversation("20", { replies: ["31"], cursor: "ACC2" })
    const result = await conversationOfPost(conversation("20"), readerPaging(h, data))
    expect(result).toMatchObject({ source: "account", cursor: cursorOf("account", "conversation", ARGS, "ACC2") })
  })
})

describe("a conversation through the reading account: what comes back", () => {
  test("the post, the ancestors root first and the replies, a note that is unknown, and the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const data = accountConversation("20", { ancestors: ["11", "12"], replies: ["33", "31"], cursor: "ACC2" })
    const result = await conversationOfPost(conversation("20", ACCOUNT), readerPaging(h, data))
    const read = { read_at: "2026-03-04T05:06:07Z", community_note: UNKNOWN_NOTE }
    expect(result).toEqual({
      method: "conversation",
      status: "ok",
      reason: null,
      post: expect.objectContaining({ id: "20", ...read }),
      ancestors: [expect.objectContaining({ id: "11", ...read }), expect.objectContaining({ id: "12", ...read })],
      results: [expect.objectContaining({ id: "33", ...read }), expect.objectContaining({ id: "31", ...read })],
      source: "account",
      cursor: cursorOf("account", "conversation", ARGS, "ACC2"),
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
  })

  test("no cursor at the end, whether the bridge says null, leaves it out or gives an empty one", async () => {
    for (const cursor of [null, undefined, ""]) {
      const data = { ...accountConversation("20", { replies: ["31"] }), cursor }
      expect(await conversationOfPost(conversation("20", ACCOUNT), readerPaging(h, data))).toMatchObject({
        cursor: null,
      })
    }
  })

  test("a continuing page that leaves the post out is ok with no post", async () => {
    const data = accountConversation(null, { replies: ["32"] })
    const result = await conversationOfPost(conversation("20", ACCOUNT), readerPaging(h, data))
    expect(result).toMatchObject({ status: "ok", reason: null, post: null, ancestors: [] })
    expect(postIds(result.results)).toEqual(["32"])
  })

  test("no post from X is not_found, with nothing else and no cursor", async () => {
    const result = await conversationOfPost(conversation("20", ACCOUNT), readerPaging(h, null))
    expect(result).toEqual({
      method: "conversation",
      status: "not_found",
      reason: "not_found",
      post: null,
      ancestors: [],
      results: [],
      source: "account",
      cursor: null,
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    const bad = [
      undefined,
      "none",
      { replies: "none", ancestors: [] },
      { post: null, ancestors: [], replies: [{ id: "31" }] },
    ]
    for (const data of bad) {
      const error = await rejected(conversationOfPost(conversation("20", ACCOUNT), readerPaging(h, data)))
      expect(error).toMatchObject(unexpectedMatch("account"))
    }
  })
})

describe("a conversation cursor that does not hold is refused before any request", () => {
  async function refused(cursor: string, extra: { source?: "fxtwitter" | "account" } = {}) {
    const reader = readerPaging(h, accountConversation("20"))
    const error = (await rejected(conversationOfPost(conversation("20", { ...extra, cursor }), reader))) as Error
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
    return error.message
  }

  test("a cursor of another post or another sort", async () => {
    expect(await refused(cursorOf("fxtwitter", "conversation", { post: "21", sort: "top" }, "B"))).toContain(
      "other arguments",
    )
    expect(await refused(cursorOf("account", "conversation", { post: "20", sort: "latest" }, "B"))).toContain(
      "other arguments",
    )
  })

  test("another read's cursor, and a cursor of the other source", async () => {
    expect(await refused(cursorOf("fxtwitter", "quotes", { post: "20" }, "B"))).toContain("another read")
    expect(await refused(cursorOf("account", "conversation", ARGS, "B"), { source: "fxtwitter" })).toContain(
      "the reading account",
    )
    expect(await refused(cursorOf("fxtwitter", "conversation", ARGS, "B"), { source: "account" })).toContain(
      "FxTwitter",
    )
  })
})

describe("conversation and thread under account_only", () => {
  const ACCOUNT_ONLY = { account_only: true }

  test("neither reads FxTwitter, whatever the source asked", async () => {
    for (const source of [undefined, "auto", "account"] as const) {
      const reader = readerPaging(h, accountConversation("20"), ACCOUNT_ONLY)
      expect(await conversationOfPost(conversation("20", { source }), reader)).toMatchObject({ source: "account" })
      const threaded = readerPaging(h, accountThread(["20"]), ACCOUNT_ONLY)
      expect(await threadOfPost(thread("20", { source }), threaded)).toMatchObject({ source: "account" })
    }
    expect(h.fake.requests).toEqual([])
  })

  test("source fxtwitter and a FxTwitter cursor are refused before any request", async () => {
    const reader = (): Reader => readerPaging(h, accountConversation("20"), ACCOUNT_ONLY)
    const cursor = cursorOf("fxtwitter", "conversation", ARGS, "B")
    for (const call of [
      conversationOfPost(conversation("20", { source: "fxtwitter" }), reader()),
      threadOfPost(thread("20", { source: "fxtwitter" }), reader()),
      conversationOfPost(conversation("20", { cursor }), reader()),
    ]) {
      expect(((await rejected(call)) as Error).message).toContain("account_only")
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })
})
