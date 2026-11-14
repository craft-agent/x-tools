import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { USER_ID_TTL_MS } from "../x/user-ids"
import { readFollows } from "./follows"
import { UNTRUSTED_NOTE, userReadOutput } from "./schemas"
import {
  accountProfile,
  accountUsersPage,
  asked,
  cursorOf,
  follows,
  followsPath,
  readerUsers,
  USER_ID,
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
const ARGS = { handle: "ada_writes" }
const ANSWERS = { user: accountProfile(), follows: accountUsersPage(["grace", "edsger"], "ACC2") }

describe("followers and following through the reading account: what is asked", () => {
  test("the first read of a handle runs user, then follows with the direction, and remembers the id", async () => {
    const reader = readerUsers(h, ANSWERS)
    await readFollows("followers")(follows("followers", "@Ada_Writes", ACCOUNT), reader)
    await readFollows("following")(follows("following", "grace", ACCOUNT), reader)
    const direction = (name: string) => ({
      op: "follows",
      args: { user_id: USER_ID, direction: name, count: 20, cursor: null },
    })
    expect(asked(h)).toEqual([
      { op: "user", args: { handle: "ada_writes" } },
      direction("followers"),
      { op: "user", args: { handle: "grace" } },
      direction("following"),
    ])
    expect(await reader.userId("ada_writes")).toBe(USER_ID)
    expect(await reader.userId("grace")).toBe(USER_ID)
  })

  test("a handle whose id is remembered takes only the follows read, for any case of it", async () => {
    await readerUsers(h, ANSWERS).rememberUserId("ada_writes", USER_ID)
    const reader = readerUsers(h, ANSWERS)
    await readFollows("followers")(follows("followers", "ada_writes", ACCOUNT), reader)
    await readFollows("following")(follows("following", "@ADA_WRITES", ACCOUNT), reader)
    expect(asked(h).map(({ op }) => op)).toEqual(["follows", "follows"])
  })

  test("a second read takes one read, and after 7 days it asks X for the id again", async () => {
    const reader = () => readerUsers(h, ANSWERS)
    await readFollows("followers")(follows("followers", "ada_writes", ACCOUNT), reader())
    await readFollows("following")(follows("following", "ada_writes", ACCOUNT), reader())
    h.clock.time += USER_ID_TTL_MS
    await readFollows("followers")(follows("followers", "ada_writes", ACCOUNT), reader())
    expect(asked(h).map(({ op }) => op)).toEqual(["user", "follows", "follows", "user", "follows"])
  })

  test("sends the limit as count and the bridge's own cursor, even under auto and with no FxTwitter request", async () => {
    await readerUsers(h, ANSWERS).rememberUserId("ada_writes", USER_ID)
    const reader = readerUsers(h, ANSWERS)
    await readFollows("followers")(follows("followers", "ada_writes", { ...ACCOUNT, limit: 7 }), reader)
    const cursor = cursorOf("account", ARGS, "ACC1", "following")
    await readFollows("following")(follows("following", "ada_writes", { cursor }), reader)
    const args = (direction: string, count: number, own: string | null) => ({
      op: "follows",
      args: { user_id: USER_ID, direction, count, cursor: own },
    })
    expect(asked(h)).toEqual([args("followers", 7, null), args("following", 20, "ACC1")])
    expect(h.fake.requests).toEqual([])
  })

  test("reads through the account the call names, and remembers the id for that account only", async () => {
    await h.label("work")
    const reader = readerUsers(h, ANSWERS)
    await readFollows("followers")(follows("followers", "ada_writes", { ...ACCOUNT, account: "work" }), reader)
    expect(h.accountReads.map((read) => read.account)).toEqual(["work", "work"])
    expect(await reader.userId("ada_writes", "work")).toBe(USER_ID)
    expect(await reader.userId("ada_writes", "default")).toBeNull()
  })

  test("falls to the account under auto when FxTwitter is down, and the cursor it gives is the account's", async () => {
    h.fake.route(followsPath("ada_writes", "followers"), { status: 503 })
    const result = await readFollows("followers")(follows("followers", "ada_writes"), readerUsers(h, ANSWERS))
    expect(result).toMatchObject({ source: "account", cursor: cursorOf("account", ARGS, "ACC2", "followers") })
  })
})

describe("followers and following through the reading account: what comes back", () => {
  test("the users in the bridge's order, at most limit, with the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await readFollows("following")(follows("following", "ada_writes", ACCOUNT), readerUsers(h, ANSWERS))
    expect(result).toEqual({
      method: "following",
      status: "ok",
      reason: null,
      results: [
        expect.objectContaining({ handle: "grace", read_at: "2026-03-04T05:06:07Z" }),
        expect.objectContaining({ handle: "edsger" }),
      ],
      source: "account",
      cursor: cursorOf("account", ARGS, "ACC2", "following"),
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    const one = await readFollows("followers")(
      follows("followers", "ada_writes", { ...ACCOUNT, limit: 1 }),
      readerUsers(h, ANSWERS),
    )
    expect(one.results).toHaveLength(1)
  })

  test("no user from X is not_found, with no follows read, no users and no cursor", async () => {
    const result = await readFollows("followers")(
      follows("followers", "ada_writes", ACCOUNT),
      readerUsers(h, { user: null }),
    )
    expect(result).toEqual({
      method: "followers",
      status: "not_found",
      reason: "not_found",
      results: [],
      source: "account",
      cursor: null,
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    expect(asked(h)).toEqual([{ op: "user", args: { handle: "ada_writes" } }])
    expect(await readerUsers(h, {}).userId("ada_writes")).toBeNull()
  })

  test("data off an operation's shape is an unexpected reply of the account", async () => {
    for (const user of [undefined, "none", {}, { id: 4001 }, { id: "ada" }]) {
      const read = readFollows("followers")(follows("followers", "ada_writes", ACCOUNT), readerUsers(h, { user }))
      expect(await rejected(read)).toMatchObject(unexpectedMatch("account"))
    }
    const pages = [undefined, "none", { users: "none" }, { users: [{ id: "4001" }] }, { users: [], cursor: 5 }]
    for (const page of pages) {
      const reader = readerUsers(h, { user: accountProfile(), follows: page })
      const read = readFollows("following")(follows("following", "ada_writes", ACCOUNT), reader)
      expect(await rejected(read)).toMatchObject(unexpectedMatch("account"))
    }
  })
})
