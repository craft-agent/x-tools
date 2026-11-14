import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { cursorOf as postCursorOf } from "../posts/list.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { readFollows, type FollowDirection } from "./follows"
import { accountProfile, accountUsersPage, asked, cursorOf, follows, readerUsers, USER_ID } from "./users.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ARGS = { handle: "ada_writes" }
const ANSWERS = { user: accountProfile(), follows: accountUsersPage(["grace"], "ACC2") }

/** The message of the refusal of `cursor` for `direction`, after checking that nothing was read. */
async function refused(
  direction: FollowDirection,
  cursor: string,
  extra: { source?: "fxtwitter" | "account" } = {},
  handle = "ada_writes",
) {
  const reader = readerUsers(h, ANSWERS)
  const error = (await rejected(
    readFollows(direction)(follows(direction, handle, { ...extra, cursor }), reader),
  )) as Error
  expect(error).toMatchObject({ code: "invalid_argument" })
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error.message
}

describe("a followers or following cursor that does not hold is refused before any request", () => {
  test("a cursor of the other direction", async () => {
    expect(await refused("following", cursorOf("fxtwitter", ARGS, "B", "followers"))).toContain("another read")
    expect(await refused("followers", cursorOf("account", ARGS, "B", "following"))).toContain("another read")
  })

  test("a cursor of another handle", async () => {
    expect(await refused("followers", cursorOf("fxtwitter", { handle: "grace" }, "B", "followers"))).toContain(
      "other arguments",
    )
    expect(await refused("following", cursorOf("account", ARGS, "B", "following"), {}, "grace")).toContain(
      "other arguments",
    )
  })

  test("the cursor of another read, such as a timeline of the same handle", async () => {
    const timeline = postCursorOf("fxtwitter", "timeline", { handle: "ada_writes", tab: "posts" }, "B")
    expect(await refused("followers", timeline)).toContain("another read")
  })

  test("a cursor of the other source", async () => {
    expect(await refused("followers", cursorOf("account", ARGS, "B", "followers"), { source: "fxtwitter" })).toContain(
      "the reading account",
    )
    expect(await refused("following", cursorOf("fxtwitter", ARGS, "B", "following"), { source: "account" })).toContain(
      "FxTwitter",
    )
  })
})

describe("a followers or following cursor that holds", () => {
  test("continues on the account even under auto, for the same handle in another case, with no FxTwitter request", async () => {
    await readerUsers(h, ANSWERS).rememberUserId("ada_writes", USER_ID)
    const cursor = cursorOf("account", ARGS, "ACC1", "followers")
    const result = await readFollows("followers")(
      follows("followers", "@ADA_Writes", { cursor }),
      readerUsers(h, ANSWERS),
    )
    expect(result).toMatchObject({ source: "account", cursor: cursorOf("account", ARGS, "ACC2", "followers") })
    expect(asked(h)).toEqual([
      { op: "follows", args: { user_id: USER_ID, direction: "followers", count: 20, cursor: "ACC1" } },
    ])
    expect(h.fake.requests).toEqual([])
  })
})

describe("followers and following under account_only", () => {
  const ACCOUNT_ONLY = { account_only: true }

  test("reads no FxTwitter, whatever the source asked", async () => {
    for (const direction of ["followers", "following"] as const) {
      for (const source of [undefined, "auto", "account"] as const) {
        const reader = readerUsers(h, ANSWERS, ACCOUNT_ONLY)
        expect(await readFollows(direction)(follows(direction, "ada_writes", { source }), reader)).toMatchObject({
          source: "account",
        })
      }
    }
    expect(h.fake.requests).toEqual([])
  })

  test("source fxtwitter and a FxTwitter cursor are refused before any request", async () => {
    const reader = () => readerUsers(h, ANSWERS, ACCOUNT_ONLY)
    const cursor = cursorOf("fxtwitter", ARGS, "B", "followers")
    for (const args of [
      follows("followers", "ada_writes", { source: "fxtwitter" }),
      follows("followers", "ada_writes", { cursor }),
    ]) {
      expect(((await rejected(readFollows("followers")(args, reader()))) as Error).message).toContain("account_only")
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })
})
