import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { conversationOfPost } from "./conversation"
import {
  accountConversation,
  conversation,
  conversationPath,
  fxConversationBody,
  postIds,
  routeConversation,
  routeGoneAt,
  routeProtectedAt,
} from "./conversation.testing"
import { cursorOf, fxRows, readerPaging } from "./list.testing"
import { NO_NOTE, fxTombstone, unexpectedMatch } from "./posts.testing"
import { UNTRUSTED_NOTE, postReadOutput } from "./schemas"
import { requested } from "./view.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const PATH = conversationPath("20")
const ARGS = { post: "20", sort: "top" }

describe("a conversation from FxTwitter: what is asked", () => {
  test("asks /2/conversation/<id> with ranking_mode likes by default and no count, for an id or a URL", async () => {
    routeConversation(h, PATH, "20", { above: ["11", "12"], replies: ["31", "32"], bottom: "BOTTOM" })
    const result = await conversationOfPost(conversation("https://x.com/ada_writes/status/20"), h.reader())
    expect(requested(h)).toEqual([PATH])
    expect(PATH).not.toContain("count")
    expect(result).toEqual({
      method: "conversation",
      status: "ok",
      reason: null,
      post: expect.objectContaining({ id: "20", url: "https://x.com/ada_writes/status/20", community_note: NO_NOTE }),
      ancestors: [expect.objectContaining({ id: "11" }), expect.objectContaining({ id: "12" })],
      results: [expect.objectContaining({ id: "31" }), expect.objectContaining({ id: "32" })],
      source: "fxtwitter",
      cursor: cursorOf("fxtwitter", "conversation", ARGS, "BOTTOM"),
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
    expect(h.accountReads).toEqual([])
  })

  test("sort latest asks ranking_mode recency", async () => {
    const path = conversationPath("20", { ranking_mode: "recency" })
    routeConversation(h, path, "20", { replies: ["31"], bottom: "BOTTOM" })
    const result = await conversationOfPost(conversation("20", { sort: "latest" }), h.reader())
    expect(requested(h)).toEqual([path])
    expect(result.cursor).toBe(cursorOf("fxtwitter", "conversation", { post: "20", sort: "latest" }, "BOTTOM"))
  })

  test("a cursor continues the page with FxTwitter's own cursor, and holds no ancestors", async () => {
    routeConversation(h, PATH, "20", { above: ["11"], replies: ["31"], bottom: "BOTTOM 1/2=" })
    const next = conversationPath("20", { ranking_mode: "likes", cursor: "BOTTOM 1/2=" })
    routeConversation(h, next, "20", { above: [], replies: ["32"] })
    const page = await conversationOfPost(conversation("20"), h.reader())
    const second = await conversationOfPost(conversation("20", { cursor: page.cursor! }), h.reader())
    expect(requested(h)).toEqual([PATH, next])
    expect(second).toMatchObject({ source: "fxtwitter", status: "ok", ancestors: [], cursor: null })
    expect(second.post).toMatchObject({ id: "20" })
    expect(postIds(second.results)).toEqual(["32"])
  })
})

describe("a conversation from FxTwitter: what comes back", () => {
  test("the ancestors leave out the post itself, wherever it stands, and tombstones", async () => {
    const [root, parent] = fxRows(["11", "12"])
    const body = fxConversationBody("20", [], [])
    h.fake.route(PATH, { status: 200, body: { ...body, thread: [root, fxTombstone("deleted"), body.status, parent] } })
    const result = await conversationOfPost(conversation("20"), h.reader())
    expect(postIds(result.ancestors)).toEqual(["11", "12"])
    expect(postIds(result.results)).toEqual([])
  })

  test("the replies keep the statuses in order and skip the rows that are none", async () => {
    const body = fxConversationBody(
      "20",
      [],
      [fxTombstone("deleted"), ...fxRows(["31"]), { type: "other" }, ...fxRows(["32"])],
    )
    h.fake.route(PATH, { status: 200, body: { ...body, cursor: { bottom: "BOTTOM" } } })
    expect(postIds((await conversationOfPost(conversation("20"), h.reader())).results)).toEqual(["31", "32"])
  })

  test("stamps the post, the ancestors and the replies with the time the reply arrived", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    routeConversation(h, PATH, "20", { above: ["11"], replies: ["31"] })
    const result = await conversationOfPost(conversation("20"), h.reader())
    const posts = [result.post, ...result.ancestors!, ...result.results!]
    expect(posts.map((post) => post?.read_at)).toEqual(Array(3).fill("2026-03-04T05:06:07Z"))
  })

  test("the cursor is the bottom cursor; no replies, or no usable bottom, leave none", async () => {
    const withReplies = fxConversationBody("20", [], fxRows(["31"]))
    const bodies: [string, object, string | null][] = [
      ["no replies", { ...withReplies, replies: [], cursor: { bottom: "BOTTOM" } }, null],
      ["no cursor", { ...withReplies, cursor: null }, null],
      ["an empty bottom", { ...withReplies, cursor: { bottom: "" } }, null],
      ["a cursor of another shape", { ...withReplies, cursor: "BOTTOM" }, null],
      ["a bottom", { ...withReplies, cursor: { bottom: "BOTTOM" } }, "BOTTOM"],
    ]
    for (const [name, body, bottom] of bodies) {
      h.fake.route(PATH, { status: 200, body })
      const { cursor } = await conversationOfPost(conversation("20"), h.reader())
      expect({ name, cursor }).toEqual({ name, cursor: bottom && cursorOf("fxtwitter", "conversation", ARGS, bottom) })
    }
  })
})

describe("a conversation from FxTwitter: no conversation to read", () => {
  const nothing = { status: "not_found", post: null, ancestors: [], results: [], cursor: null }

  test("a 401 is protected without a reading account, with nothing else", async () => {
    routeProtectedAt(h, PATH)
    const result = await conversationOfPost(conversation("20"), h.reader())
    expect(result).toEqual({
      ...nothing,
      method: "conversation",
      status: "protected",
      reason: "protected",
      source: "fxtwitter",
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
  })

  test("a 401 goes to the reading account under auto, and stays with FxTwitter under source fxtwitter", async () => {
    await h.label()
    routeProtectedAt(h, PATH)
    const data = accountConversation("20", { ancestors: ["11"], replies: ["31"], cursor: "ACC2" })
    const result = await conversationOfPost(conversation("20"), readerPaging(h, data))
    expect(result).toMatchObject({
      source: "account",
      status: "ok",
      cursor: cursorOf("account", "conversation", ARGS, "ACC2"),
    })
    expect(h.accountReads).toHaveLength(1)
    const pinned = await conversationOfPost(conversation("20", { source: "fxtwitter" }), readerPaging(h, data))
    expect(pinned).toMatchObject({ ...nothing, source: "fxtwitter", status: "protected" })
    expect(h.accountReads).toHaveLength(1)
  })

  test("a 404 is final, with the reason FxTwitter gives, and the reading account is not asked", async () => {
    await h.label()
    const reader = readerPaging(h, accountConversation("20"))
    for (const reason of ["deleted", "suspended", undefined]) {
      routeGoneAt(h, PATH, reason)
      const result = await conversationOfPost(conversation("20"), reader)
      expect(result).toMatchObject({ ...nothing, source: "fxtwitter", reason: reason ?? "not_found" })
    }
    expect(h.accountReads).toEqual([])
  })

  test("a 404 for a post only a signed-in reader may see goes to the reading account", async () => {
    await h.label()
    for (const reason of ["private", "blocked", "unavailable"]) {
      routeGoneAt(h, PATH, reason)
      const result = await conversationOfPost(conversation("20"), readerPaging(h, accountConversation("20")))
      expect(result).toMatchObject({ source: "account", status: "ok" })
    }
    routeGoneAt(h, PATH, "blocked")
    const pinned = await conversationOfPost(conversation("20", { source: "fxtwitter" }), h.reader())
    expect(pinned).toMatchObject({ source: "fxtwitter", status: "unavailable", reason: "blocked" })
  })

  test("a reply off shape falls to the reading account under auto: a status, a body, a post", async () => {
    await h.label()
    const replies = [
      { status: 418, body: {} },
      { status: 200, body: { status: null, thread: [], replies: [] } },
      { status: 200, body: { ...fxConversationBody("20", [], []), replies: "none" } },
      { status: 200, body: { ...fxConversationBody("20", [], []), status: { type: "status", id: 5 } } },
    ]
    for (const reply of replies) {
      h.fake.route(PATH, reply)
      const result = await conversationOfPost(conversation("20"), readerPaging(h, accountConversation("20")))
      expect(result.source).toBe("account")
    }
    expect(h.accountReads).toHaveLength(replies.length)
  })

  test("without a reading account a reply off shape stands as an unexpected reply", async () => {
    h.fake.route(PATH, { status: 418, body: {} })
    expect(await rejected(conversationOfPost(conversation("20"), h.reader()))).toMatchObject(
      unexpectedMatch("fxtwitter", 418),
    )
    h.fake.route(PATH, { status: 200, body: { thread: [], replies: [] } })
    expect(await rejected(conversationOfPost(conversation("20"), h.reader()))).toMatchObject(
      unexpectedMatch("fxtwitter", 200),
    )
  })
})
