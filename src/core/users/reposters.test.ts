import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { cursorOf as postCursorOf, routeList } from "../posts/list.testing"
import { fxStatus, fxTombstone, unexpectedMatch } from "../posts/posts.testing"
import { requested } from "../posts/view.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { repostersOfPost } from "./reposters"
import { UNTRUSTED_NOTE, userReadOutput } from "./schemas"
import {
  accountUsersPage,
  asked,
  cursorOf,
  fxProfileRows,
  handlesOf,
  readerUsers,
  reposters,
  repostsPath,
} from "./users.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ARGS = { post: "20" }
const ANSWERS = { reposters: accountUsersPage(["ada", "grace"], "ACC2") }

describe("reposters from FxTwitter", () => {
  test("asks the status's reposts route with count, then FxTwitter's own cursor, for a post URL as for an id", async () => {
    const first = repostsPath("20", { count: "5" })
    const next = repostsPath("20", { count: "7", cursor: "BOTTOM 1/2=" })
    routeList(h, first, fxProfileRows(["ada"]), "BOTTOM 1/2=")
    routeList(h, next, fxProfileRows(["grace"]))
    const page = await repostersOfPost(reposters("https://x.com/ada_writes/status/20?s=1", { limit: 5 }), h.reader())
    const second = await repostersOfPost(reposters(" 20 ", { limit: 7, cursor: page.cursor! }), h.reader())
    expect(requested(h)).toEqual([first, next])
    expect(first).toBe("/2/status/20/reposts?count=5")
    expect(handlesOf(second)).toEqual(["grace"])
    expect(second).toMatchObject({ source: "fxtwitter", cursor: null })
  })

  test("returns the users of the page with the cursor for this read, and no account is read", async () => {
    routeList(h, repostsPath("20"), fxProfileRows(["ada", "grace"]), "BOTTOM")
    const result = await repostersOfPost(reposters("20"), h.reader())
    expect(result).toEqual({
      method: "reposters",
      results: [expect.objectContaining({ handle: "ada" }), expect.objectContaining({ handle: "grace" })],
      source: "fxtwitter",
      cursor: cursorOf("fxtwitter", ARGS, "BOTTOM", "reposters"),
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    expect(h.accountReads).toEqual([])
  })

  test("keeps at most limit profiles and skips the rows of another type", async () => {
    const rows = [fxTombstone("deleted"), fxStatus(), ...fxProfileRows(["ada", "grace", "edsger"])]
    routeList(h, repostsPath("20", { count: "2" }), rows, "BOTTOM")
    const result = await repostersOfPost(reposters("20", { limit: 2 }), h.reader())
    expect(handlesOf(result)).toEqual(["ada", "grace"])
  })

  test("a 404 is an empty page, with no cursor and no account read", async () => {
    await h.label()
    h.fake.route(repostsPath("20"), { status: 404, body: { code: 404, message: "NOT_FOUND" } })
    const result = await repostersOfPost(reposters("20"), readerUsers(h, ANSWERS))
    expect(result).toMatchObject({ results: [], cursor: null, source: "fxtwitter" })
    expect(h.accountReads).toEqual([])
  })

  test("a 400 is invalid_argument, never tried on the reading account", async () => {
    await h.label()
    h.fake.route(repostsPath("20"), { status: 400, body: { code: 400, message: "Bad count." } })
    expect(await rejected(repostersOfPost(reposters("20"), readerUsers(h, ANSWERS)))).toMatchObject({
      code: "invalid_argument",
      message: "FxTwitter refused the query: Bad count.",
    })
    expect(h.accountReads).toEqual([])
  })

  test("a reply off shape falls to the reading account under auto, and without one stands as an unexpected reply", async () => {
    h.fake.route(repostsPath("20"), { status: 200, body: { code: 200 } })
    expect(await rejected(repostersOfPost(reposters("20"), h.reader()))).toMatchObject(
      unexpectedMatch("fxtwitter", 200),
    )
    await h.label()
    expect((await repostersOfPost(reposters("20"), readerUsers(h, ANSWERS))).source).toBe("account")
  })
})

describe("reposters through the reading account", () => {
  beforeEach(async () => {
    await h.label()
  })

  test("asks the bridge's reposters operation with the id, the limit as count and the bridge's own cursor", async () => {
    await repostersOfPost(reposters("20", { source: "account", limit: 7 }), readerUsers(h, ANSWERS))
    const cursor = cursorOf("account", ARGS, "ACC1", "reposters")
    await repostersOfPost(reposters("https://x.com/i/web/status/20", { cursor }), readerUsers(h, ANSWERS))
    const args = (count: number, own: string | null) => ({ op: "reposters", args: { id: "20", count, cursor: own } })
    expect(asked(h)).toEqual([args(7, null), args(20, "ACC1")])
    expect(h.fake.requests).toEqual([])
  })

  test("returns the bridge's users in its order, at most limit, with the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await repostersOfPost(reposters("20", { source: "account" }), readerUsers(h, ANSWERS))
    expect(result).toEqual({
      method: "reposters",
      results: [
        expect.objectContaining({ handle: "ada", read_at: "2026-03-04T05:06:07Z" }),
        expect.objectContaining({ handle: "grace" }),
      ],
      source: "account",
      cursor: cursorOf("account", ARGS, "ACC2", "reposters"),
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    const one = await repostersOfPost(reposters("20", { source: "account", limit: 1 }), readerUsers(h, ANSWERS))
    expect(one.results).toHaveLength(1)
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    for (const page of [undefined, "none", { users: "none" }, { users: [{ id: "4001" }] }]) {
      const read = repostersOfPost(reposters("20", { source: "account" }), readerUsers(h, { reposters: page }))
      expect(await rejected(read)).toMatchObject(unexpectedMatch("account"))
    }
  })

  test("reads through the account the call names", async () => {
    await h.label("work")
    await repostersOfPost(reposters("20", { source: "account", account: "work" }), readerUsers(h, ANSWERS))
    expect(h.accountReads.map((read) => read.account)).toEqual(["work"])
  })
})

describe("a reposters cursor", () => {
  beforeEach(async () => {
    await h.label()
  })

  async function refused(cursor: string, extra: { source?: "fxtwitter" | "account" } = {}, post = "20") {
    const error = (await rejected(
      repostersOfPost(reposters(post, { ...extra, cursor }), readerUsers(h, ANSWERS)),
    )) as Error
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
    return error.message
  }

  test("of the quotes of the same post is refused before any request", async () => {
    expect(await refused(postCursorOf("fxtwitter", "quotes", { post: "20" }, "B"))).toContain("another read")
    expect(await refused(postCursorOf("account", "quotes", { post: "20" }, "B"))).toContain("another read")
  })

  test("of another post or the other source is refused before any request", async () => {
    expect(await refused(cursorOf("fxtwitter", { post: "21" }, "B", "reposters"))).toContain("other arguments")
    expect(await refused(cursorOf("account", ARGS, "B", "reposters"), { source: "fxtwitter" })).toContain(
      "the reading account",
    )
    expect(await refused(cursorOf("fxtwitter", ARGS, "B", "reposters"), { source: "account" })).toContain("FxTwitter")
  })

  test("continues on FxTwitter with no account read, and the same post by URL continues", async () => {
    routeList(h, repostsPath("20", { count: "20", cursor: "B" }), fxProfileRows(["grace"]))
    const cursor = cursorOf("fxtwitter", ARGS, "B", "reposters")
    const result = await repostersOfPost(
      reposters("https://twitter.com/a/status/20", { cursor }),
      readerUsers(h, ANSWERS),
    )
    expect(handlesOf(result)).toEqual(["grace"])
    expect(h.accountReads).toEqual([])
  })
})

describe("reposters under account_only", () => {
  const ACCOUNT_ONLY = { account_only: true }

  beforeEach(async () => {
    await h.label()
  })

  test("reads no FxTwitter, whatever the source asked", async () => {
    for (const source of [undefined, "auto", "account"] as const) {
      const reader = readerUsers(h, ANSWERS, ACCOUNT_ONLY)
      expect(await repostersOfPost(reposters("20", { source }), reader)).toMatchObject({ source: "account" })
    }
    expect(h.fake.requests).toEqual([])
  })

  test("source fxtwitter and a FxTwitter cursor are refused before any request", async () => {
    const reader = () => readerUsers(h, ANSWERS, ACCOUNT_ONLY)
    const cursor = cursorOf("fxtwitter", ARGS, "B", "reposters")
    for (const args of [reposters("20", { source: "fxtwitter" }), reposters("20", { cursor })]) {
      expect(((await rejected(repostersOfPost(args, reader()))) as Error).message).toContain("account_only")
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })
})
