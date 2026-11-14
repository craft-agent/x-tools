import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { fxListReply } from "../posts/list.testing"
import { fxStatus, fxTombstone, unexpectedMatch } from "../posts/posts.testing"
import { requested } from "../posts/view.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { UNTRUSTED_NOTE, userReadOutput } from "./schemas"
import { searchUsers } from "./search"
import {
  accountUsersPage,
  cursorOf,
  firstSearchPath,
  fxProfile,
  fxProfileRows,
  readerUsers,
  search,
  searchPath,
} from "./users.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ARGS = { query: "slow reading" }
const PATH = firstSearchPath("slow reading")

/** The handles of a result's users. */
const handlesOf = (result: { results?: { handle: string }[] }) => result.results?.map((user) => user.handle)

describe("a search of users from FxTwitter", () => {
  test("asks the route with the query as q, then count and, when continuing, FxTwitter's own cursor", async () => {
    const first = searchPath({ q: "slow reading", count: "5" })
    const next = searchPath({ q: "slow reading", count: "7", cursor: "BOTTOM 1/2=" })
    h.fake.route(first, fxListReply(fxProfileRows(["ada"]), "BOTTOM 1/2="))
    h.fake.route(next, fxListReply(fxProfileRows(["grace"])))
    const page = await searchUsers(search("slow reading", { limit: 5 }), h.reader())
    const second = await searchUsers(search("slow reading", { limit: 7, cursor: page.cursor! }), h.reader())
    expect(requested(h)).toEqual([first, next])
    expect(handlesOf(second)).toEqual(["grace"])
    expect(second).toMatchObject({ source: "fxtwitter", cursor: null })
  })

  test("returns the users of the page with the cursor for this read, and no account is read", async () => {
    h.fake.route(PATH, fxListReply(fxProfileRows(["ada", "grace"]), "BOTTOM"))
    const result = await searchUsers(search("slow reading"), h.reader())
    expect(result).toEqual({
      method: "search",
      results: [expect.objectContaining({ handle: "ada" }), expect.objectContaining({ handle: "grace" })],
      source: "fxtwitter",
      cursor: cursorOf("fxtwitter", ARGS, "BOTTOM"),
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    expect(h.accountReads).toEqual([])
  })

  test("keeps at most limit profiles, skips the rows of another type and stamps them with the time of the reply", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const rows = [fxTombstone("deleted"), fxStatus(), ...fxProfileRows(["ada", "grace", "edsger"]), { type: "other" }]
    h.fake.route(searchPath({ q: "slow reading", count: "2" }), fxListReply(rows, "BOTTOM"))
    const result = await searchUsers(search("slow reading", { limit: 2 }), h.reader())
    expect(handlesOf(result)).toEqual(["ada", "grace"])
    expect(result.results!.map((user) => user.read_at)).toEqual(Array(2).fill("2026-03-04T05:06:07Z"))
  })

  test("a 404 is an empty page, with no cursor and no account read", async () => {
    await h.label()
    h.fake.route(PATH, { status: 404, body: { code: 404, message: "NOT_FOUND" } })
    const result = await searchUsers(search("slow reading"), readerUsers(h, { user_search: accountUsersPage(["ada"]) }))
    expect(result).toMatchObject({ results: [], cursor: null, source: "fxtwitter" })
    expect(h.accountReads).toEqual([])
  })

  test("a 400 is invalid_argument with FxTwitter's words, never tried on the reading account", async () => {
    await h.label()
    h.fake.route(PATH, { status: 400, body: { code: 400, message: "Query is too long." } })
    const error = await rejected(
      searchUsers(search("slow reading"), readerUsers(h, { user_search: accountUsersPage([]) })),
    )
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: "FxTwitter refused the query: Query is too long.",
    })
    expect(h.accountReads).toEqual([])
  })

  test("the cursor is the bottom cursor; no rows or no usable bottom leave none", async () => {
    const bodies: [string, unknown[], unknown, string | null][] = [
      ["no rows", [], { bottom: "BOTTOM" }, null],
      ["no cursor", fxProfileRows(["ada"]), null, null],
      ["an empty bottom", fxProfileRows(["ada"]), { bottom: "" }, null],
      ["a bottom", fxProfileRows(["ada"]), { bottom: "BOTTOM" }, "BOTTOM"],
    ]
    for (const [name, rows, cursor, bottom] of bodies) {
      h.fake.route(PATH, { status: 200, body: { ...fxListReply(rows).body, cursor } })
      const result = await searchUsers(search("slow reading"), h.reader())
      expect({ name, cursor: result.cursor }).toEqual({ name, cursor: bottom && cursorOf("fxtwitter", ARGS, bottom) })
    }
  })

  test("a reply off shape falls to the reading account under auto", async () => {
    await h.label()
    const replies = [
      { status: 418, body: {} },
      { status: 200, body: { code: 200 } },
      { status: 200, body: fxListReply([fxProfile({ id: 4001 })]).body },
    ]
    for (const reply of replies) {
      h.fake.route(PATH, reply)
      const answers = { user_search: accountUsersPage(["ada"]) }
      expect((await searchUsers(search("slow reading"), readerUsers(h, answers))).source).toBe("account")
    }
  })

  test("without a reading account a reply off shape stands as an unexpected reply", async () => {
    h.fake.route(PATH, { status: 200, body: { code: 200 } })
    expect(await rejected(searchUsers(search("slow reading"), h.reader()))).toMatchObject(
      unexpectedMatch("fxtwitter", 200),
    )
  })
})
