import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import {
  accountThread,
  postIds,
  routeGoneAt,
  routeProtectedAt,
  routeThread,
  thread,
  threadPath,
} from "./conversation.testing"
import { fxRows, readerPaging } from "./list.testing"
import { NO_NOTE, UNKNOWN_NOTE, fxTombstone, unexpectedMatch } from "./posts.testing"
import { UNTRUSTED_NOTE, postReadOutput } from "./schemas"
import { threadOfPost } from "./thread"
import { requested } from "./view.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const PATH = threadPath("20")

describe("a thread from FxTwitter", () => {
  test("asks /2/thread/<id> with no query, for an id or a URL, and gives the chain oldest first, with no cursor", async () => {
    routeThread(h, "20", fxRows(["20", "21", "22"]))
    const result = await threadOfPost(thread("https://x.com/ada_writes/status/20"), h.reader())
    expect(requested(h)).toEqual([PATH])
    expect(result).toEqual({
      method: "thread",
      status: "ok",
      reason: null,
      results: [
        expect.objectContaining({ id: "20", community_note: NO_NOTE }),
        expect.objectContaining({ id: "21" }),
        expect.objectContaining({ id: "22" }),
      ],
      source: "fxtwitter",
      cursor: null,
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
    expect(result).not.toHaveProperty("post")
    expect(result).not.toHaveProperty("ancestors")
    expect(h.accountReads).toEqual([])
  })

  test("skips the tombstones, and stamps every post with the time the reply arrived", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const [first, second] = fxRows(["20", "21"])
    routeThread(h, "20", [first, fxTombstone("deleted"), { type: "other" }, second])
    const result = await threadOfPost(thread("20"), h.reader())
    expect(postIds(result.results)).toEqual(["20", "21"])
    expect(result.results?.map((post) => post.read_at)).toEqual(["2026-03-04T05:06:07Z", "2026-03-04T05:06:07Z"])
  })

  test("a 401 is protected without a reading account, with no posts", async () => {
    routeProtectedAt(h, PATH)
    const result = await threadOfPost(thread("20"), h.reader())
    expect(result).toEqual({
      method: "thread",
      status: "protected",
      reason: "protected",
      results: [],
      source: "fxtwitter",
      cursor: null,
      note: UNTRUSTED_NOTE,
    })
  })

  test("a 401 goes to the reading account under auto, and stays with FxTwitter under source fxtwitter", async () => {
    await h.label()
    routeProtectedAt(h, PATH)
    const result = await threadOfPost(thread("20"), readerPaging(h, accountThread(["20", "21"])))
    expect(result).toMatchObject({ source: "account", status: "ok" })
    expect(postIds(result.results)).toEqual(["20", "21"])
    const pinned = await threadOfPost(thread("20", { source: "fxtwitter" }), readerPaging(h, accountThread(["20"])))
    expect(pinned).toMatchObject({ source: "fxtwitter", status: "protected", results: [] })
    expect(h.accountReads).toHaveLength(1)
  })

  test("a 404 is final with the reason FxTwitter gives, and the reading account is not asked", async () => {
    await h.label()
    const reader = readerPaging(h, accountThread(["20"]))
    for (const reason of ["deleted", "suspended", undefined]) {
      routeGoneAt(h, PATH, reason)
      const result = await threadOfPost(thread("20"), reader)
      expect(result).toMatchObject({
        source: "fxtwitter",
        status: "not_found",
        reason: reason ?? "not_found",
        results: [],
      })
    }
    expect(h.accountReads).toEqual([])
  })

  test("a reply off shape falls to the reading account under auto, and stands without one", async () => {
    const replies = [
      { status: 418, body: {} },
      { status: 200, body: { thread: "none" } },
      { status: 200, body: { thread: [{ type: "status", id: 5 }] } },
    ]
    for (const reply of replies) {
      h.fake.route(PATH, reply)
      expect(await rejected(threadOfPost(thread("20"), h.reader()))).toMatchObject(unexpectedMatch("fxtwitter"))
    }
    await h.label()
    for (const reply of replies) {
      h.fake.route(PATH, reply)
      expect(await threadOfPost(thread("20"), readerPaging(h, accountThread(["20"])))).toMatchObject({
        source: "account",
      })
    }
  })
})

describe("a thread through the reading account", () => {
  beforeEach(async () => {
    await h.label()
  })

  test("runs the bridge's thread with the id alone, and gives the posts with a note that is unknown", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await threadOfPost(
      thread("https://x.com/ada_writes/status/20", { source: "account", account: "default" }),
      readerPaging(h, accountThread(["20", "21"])),
    )
    expect(h.accountReads.map(({ op, args }) => ({ op, args }))).toEqual([{ op: "thread", args: { id: "20" } }])
    expect(result).toMatchObject({ status: "ok", reason: null, source: "account", cursor: null })
    expect(result.results).toEqual([
      expect.objectContaining({ id: "20", read_at: "2026-03-04T05:06:07Z", community_note: UNKNOWN_NOTE }),
      expect.objectContaining({ id: "21", community_note: UNKNOWN_NOTE }),
    ])
    expect(h.fake.requests).toEqual([])
  })

  test("no post from X is not_found, with no posts", async () => {
    const result = await threadOfPost(thread("20", { source: "account" }), readerPaging(h, null))
    expect(result).toEqual({
      method: "thread",
      status: "not_found",
      reason: "not_found",
      results: [],
      source: "account",
      cursor: null,
      note: UNTRUSTED_NOTE,
    })
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    for (const data of [undefined, "none", { posts: "none" }, { posts: [{ id: "20" }] }]) {
      const error = await rejected(threadOfPost(thread("20", { source: "account" }), readerPaging(h, data)))
      expect(error).toMatchObject(unexpectedMatch("account"))
    }
  })
})
