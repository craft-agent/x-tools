import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { UNTRUSTED_NOTE, userReadOutput } from "./schemas"
import { accountProfile, profilePath, readerUsers, view } from "./users.testing"
import { viewUser } from "./view"

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

describe("a profile through the reading account", () => {
  test("asks the bridge's user operation with the handle in lower case, one read, and stamps the profile", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await viewUser(view("@Ada_Writes", ACCOUNT), readerUsers(h, { user: accountProfile() }))
    expect(h.accountReads.map(({ op, args }) => ({ op, args }))).toEqual([
      { op: "user", args: { handle: "ada_writes" } },
    ])
    expect(result).toEqual({
      method: "view",
      status: "ok",
      reason: null,
      user: expect.objectContaining({ id: "4001", handle: "ada_writes", read_at: "2026-03-04T05:06:07Z" }),
      source: "account",
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    expect(h.fake.requests).toEqual([])
  })

  test("remembers the user id of the handle, so a later read of it takes no user read", async () => {
    const reader = readerUsers(h, { user: accountProfile({ id: "4002" }) })
    await viewUser(view("Ada_Writes", ACCOUNT), reader)
    expect(await reader.userId("ada_writes")).toBe("4002")
  })

  test("reads through the account the call names, and remembers the id for that account only", async () => {
    await h.label("work")
    const reader = readerUsers(h, { user: accountProfile() })
    await viewUser(view("ada_writes", { ...ACCOUNT, account: "work" }), reader)
    expect(h.accountReads.map((read) => read.account)).toEqual(["work"])
    expect(await reader.userId("ada_writes", "work")).toBe("4001")
    expect(await reader.userId("ada_writes", "default")).toBeNull()
  })

  test("no user from X is not_found, with nothing remembered", async () => {
    const reader = readerUsers(h, { user: null })
    const result = await viewUser(view("ada_writes", ACCOUNT), reader)
    expect(result).toEqual({
      method: "view",
      status: "not_found",
      reason: "not_found",
      user: null,
      source: "account",
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    expect(await reader.userId("ada_writes")).toBeNull()
  })

  test("data off the operation's shape is an unexpected reply of the account, and no id is remembered", async () => {
    for (const user of [undefined, "none", {}, accountProfile({ id: "ada" }), accountProfile({ username: 5 })]) {
      const reader = readerUsers(h, { user })
      expect(await rejected(viewUser(view("ada_writes", ACCOUNT), reader))).toMatchObject(unexpectedMatch("account"))
    }
    expect(await readerUsers(h, {}).userId("ada_writes")).toBeNull()
  })

  test("falls to the account under auto when FxTwitter is down", async () => {
    h.fake.route(profilePath("ada_writes"), { status: 503 })
    expect(await viewUser(view("ada_writes"), readerUsers(h, { user: accountProfile() }))).toMatchObject({
      status: "ok",
      source: "account",
    })
  })
})
