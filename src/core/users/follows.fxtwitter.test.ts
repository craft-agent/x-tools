import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { routeList } from "../posts/list.testing"
import { fxStatus, fxTombstone, unexpectedMatch } from "../posts/posts.testing"
import { requested } from "../posts/view.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { readFollows, type FollowDirection } from "./follows"
import { UNTRUSTED_NOTE, userReadOutput } from "./schemas"
import {
  accountProfile,
  accountUsersPage,
  cursorOf,
  follows,
  followsPath,
  fxProfileRows,
  handlesOf,
  readerUsers,
} from "./users.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const DIRECTIONS: readonly FollowDirection[] = ["followers", "following"]
const ARGS = { handle: "ada_writes" }

describe("followers and following from FxTwitter: what is asked", () => {
  test("asks each direction's profile route with count, then FxTwitter's own cursor, for the handle in lower case", async () => {
    const paths: string[] = []
    for (const direction of DIRECTIONS) {
      const first = followsPath("ada_writes", direction, { count: "5" })
      const next = followsPath("ada_writes", direction, { count: "7", cursor: "BOTTOM 1/2=" })
      routeList(h, first, fxProfileRows(["ada"]), "BOTTOM 1/2=")
      routeList(h, next, fxProfileRows(["grace"]))
      const read = readFollows(direction)
      const page = await read(follows(direction, "@Ada_Writes", { limit: 5 }), h.reader())
      const second = await read(follows(direction, "ada_writes", { limit: 7, cursor: page.cursor! }), h.reader())
      expect(handlesOf(second)).toEqual(["grace"])
      expect(second).toMatchObject({ source: "fxtwitter", status: "ok", cursor: null })
      paths.push(first, next)
    }
    expect(requested(h)).toEqual(paths)
    expect(requested(h)[0]).toBe("/2/profile/ada_writes/followers?count=5")
    expect(requested(h)[2]).toBe("/2/profile/ada_writes/following?count=5")
  })

  test("returns the users of the page with the cursor for this read, and no account is read", async () => {
    for (const direction of DIRECTIONS) {
      routeList(h, followsPath("ada_writes", direction), fxProfileRows(["ada", "grace"]), "BOTTOM")
      const result = await readFollows(direction)(follows(direction, "ada_writes"), h.reader())
      expect(result).toEqual({
        method: direction,
        status: "ok",
        reason: null,
        results: [expect.objectContaining({ handle: "ada" }), expect.objectContaining({ handle: "grace" })],
        source: "fxtwitter",
        cursor: cursorOf("fxtwitter", ARGS, "BOTTOM", direction),
        note: UNTRUSTED_NOTE,
      })
      expect(userReadOutput.parse(result)).toEqual(result)
    }
    expect(h.accountReads).toEqual([])
  })

  test("keeps at most limit profiles, skips the rows of another type and stamps them with the time of the reply", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const rows = [fxTombstone("deleted"), fxStatus(), ...fxProfileRows(["ada", "grace", "edsger"]), { type: "other" }]
    routeList(h, followsPath("ada_writes", "followers", { count: "2" }), rows, "BOTTOM")
    const result = await readFollows("followers")(follows("followers", "ada_writes", { limit: 2 }), h.reader())
    expect(handlesOf(result)).toEqual(["ada", "grace"])
    expect(result.results!.map((user) => user.read_at)).toEqual(Array(2).fill("2026-03-04T05:06:07Z"))
  })
})

describe("followers and following from FxTwitter: no list to read", () => {
  const gone = { results: [], cursor: null, source: "fxtwitter" as const, note: UNTRUSTED_NOTE }
  const protectedReply = { status: 401, body: { code: 401, message: "PRIVATE_USER" } }

  test("a 404 is final, with the reason FxTwitter gives, and the reading account is not asked under auto", async () => {
    await h.label()
    const reader = readerUsers(h, { user: accountProfile(), follows: accountUsersPage([]) })
    const replies = [
      [{ status: 404, body: { code: 404, message: "USER_NOT_FOUND", reason: "suspended" } }, "suspended"],
      [{ status: 404, body: { code: 404, message: "USER_NOT_FOUND" } }, "not_found"],
      [{ status: 404 }, "not_found"],
    ] as const
    for (const direction of DIRECTIONS) {
      for (const [reply, reason] of replies) {
        h.fake.route(followsPath("ada_writes", direction), reply)
        const result = await readFollows(direction)(follows(direction, "ada_writes"), reader)
        expect(result).toEqual({ ...gone, method: direction, status: "not_found", reason })
        expect(userReadOutput.parse(result)).toEqual(result)
      }
    }
    expect(h.accountReads).toEqual([])
  })

  test("a 401 is protected without a reading account, with no users", async () => {
    h.fake.route(followsPath("ada_writes", "followers"), protectedReply)
    const result = await readFollows("followers")(follows("followers", "ada_writes"), h.reader())
    expect(result).toEqual({ ...gone, method: "followers", status: "protected", reason: "protected" })
    expect(userReadOutput.parse(result)).toEqual(result)
  })

  test("a 401 goes to the reading account under auto, and stays with FxTwitter under source fxtwitter", async () => {
    await h.label()
    h.fake.route(followsPath("ada_writes", "following"), protectedReply)
    const answers = { user: accountProfile(), follows: accountUsersPage(["grace"], "ACC2") }
    const read = readFollows("following")
    const result = await read(follows("following", "ada_writes"), readerUsers(h, answers))
    expect(result).toMatchObject({
      source: "account",
      status: "ok",
      cursor: cursorOf("account", ARGS, "ACC2", "following"),
    })
    expect(h.accountReads.map((read) => read.op)).toEqual(["user", "follows"])
    const pinned = await read(follows("following", "ada_writes", { source: "fxtwitter" }), readerUsers(h, answers))
    expect(pinned).toMatchObject({ ...gone, status: "protected" })
    expect(h.accountReads).toHaveLength(2)
  })

  test("a reply off shape falls to the reading account under auto, and without one stands as an unexpected reply", async () => {
    h.fake.route(followsPath("ada_writes", "followers"), { status: 200, body: { code: 200 } })
    expect(await rejected(readFollows("followers")(follows("followers", "ada_writes"), h.reader()))).toMatchObject(
      unexpectedMatch("fxtwitter", 200),
    )
    await h.label()
    const answers = { user: accountProfile(), follows: accountUsersPage([]) }
    const result = await readFollows("followers")(follows("followers", "ada_writes"), readerUsers(h, answers))
    expect(result.source).toBe("account")
  })
})
