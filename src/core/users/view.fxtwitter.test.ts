import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { READ_AT, unexpectedMatch } from "../posts/posts.testing"
import { requested } from "../posts/view.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { UNTRUSTED_NOTE, userReadOutput } from "./schemas"
import { accountProfile, fxProfile, fxProfileReply, profilePath, readerUsers, view } from "./users.testing"
import { viewUser } from "./view"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const PATH = profilePath("ada_writes")

describe("a profile from FxTwitter", () => {
  test("asks the profile's route with the handle in lower case, with or without its @", async () => {
    h.fake.route(PATH, fxProfileReply())
    await viewUser(view("@Ada_Writes"), h.reader())
    await viewUser(view("ada_writes"), h.reader())
    expect(requested(h)).toEqual([PATH, PATH])
  })

  test("is ok with the profile, read at the time of the reply, and no account is read", async () => {
    h.fake.route(PATH, fxProfileReply())
    h.clock.time = Date.parse(READ_AT)
    const result = await viewUser(view("ada_writes"), h.reader())
    expect(result).toEqual({
      method: "view",
      status: "ok",
      reason: null,
      user: expect.objectContaining({ id: "4001", handle: "ada_writes", read_at: READ_AT, clipped: [] }),
      source: "fxtwitter",
      note: UNTRUSTED_NOTE,
    })
    expect(userReadOutput.parse(result)).toEqual(result)
    expect(h.accountReads).toEqual([])
  })

  test("a profile off shape is an unexpected reply, whether the row or the reply holding it", async () => {
    for (const body of [{ code: 200 }, { code: 200, user: null }, { code: 200, user: fxProfile({ id: 4001 }) }, []]) {
      h.fake.route(PATH, { status: 200, body })
      expect(await rejected(viewUser(view("ada_writes"), h.reader()))).toMatchObject(unexpectedMatch("fxtwitter", 200))
    }
  })
})

describe("a profile FxTwitter does not find", () => {
  const missing = { status: 404, body: { code: 404, message: "USER_NOT_FOUND" } }
  const suspended = { status: 404, body: { code: 404, message: "USER_NOT_FOUND", reason: "suspended" } }

  test("a 404 is final, with the reason FxTwitter gives, and under auto the reading account is not asked", async () => {
    await h.label()
    const reader = readerUsers(h, { user: accountProfile() })
    for (const [reply, reason] of [
      [suspended, "suspended"],
      [missing, "not_found"],
      [{ status: 404 }, "not_found"],
      [{ status: 404, body: '"gone"' }, "not_found"],
    ] as const) {
      h.fake.route(PATH, reply)
      const result = await viewUser(view("ada_writes"), reader)
      expect(result).toEqual({
        method: "view",
        status: "not_found",
        reason,
        user: null,
        source: "fxtwitter",
        note: UNTRUSTED_NOTE,
      })
      expect(userReadOutput.parse(result)).toEqual(result)
    }
    expect(h.accountReads).toEqual([])
  })

  test("a 401 is protected without a reading account, with no user", async () => {
    h.fake.route(PATH, { status: 401, body: { code: 401, message: "PRIVATE_USER" } })
    const result = await viewUser(view("ada_writes"), h.reader())
    expect(result).toMatchObject({ status: "protected", reason: "protected", user: null, source: "fxtwitter" })
    expect(userReadOutput.parse(result)).toEqual(result)
  })

  test("a 401 goes to the reading account under auto, and stays with FxTwitter under source fxtwitter", async () => {
    await h.label()
    h.fake.route(PATH, { status: 401, body: { code: 401, message: "PRIVATE_USER" } })
    const answers = { user: accountProfile({ protected: true }) }
    const result = await viewUser(view("ada_writes"), readerUsers(h, answers))
    expect(result).toMatchObject({ status: "ok", source: "account", user: { protected: true } })
    const pinned = await viewUser(view("ada_writes", { source: "fxtwitter" }), readerUsers(h, answers))
    expect(pinned).toMatchObject({ status: "protected", source: "fxtwitter", user: null })
    expect(h.accountReads).toHaveLength(1)
  })

  test("a reply off shape falls to the reading account under auto", async () => {
    await h.label()
    for (const reply of [{ status: 418, body: {} }, { status: 200, body: { code: 200 } }, { status: 503 }]) {
      h.fake.route(PATH, reply)
      const result = await viewUser(view("ada_writes"), readerUsers(h, { user: accountProfile() }))
      expect(result.source).toBe("account")
    }
  })

  test("without a reading account a reply off shape stands as an unexpected reply", async () => {
    h.fake.route(PATH, { status: 418, body: {} })
    expect(await rejected(viewUser(view("ada_writes"), h.reader()))).toMatchObject(unexpectedMatch("fxtwitter", 418))
  })
})

describe("a profile under account_only", () => {
  test("reads no FxTwitter, whatever the source asked, and source fxtwitter is refused first", async () => {
    await h.label()
    for (const source of [undefined, "auto", "account"] as const) {
      const reader = readerUsers(h, { user: accountProfile() }, { account_only: true })
      expect(await viewUser(view("ada_writes", { source }), reader)).toMatchObject({ source: "account" })
    }
    const reader = readerUsers(h, { user: accountProfile() }, { account_only: true })
    const error = (await rejected(viewUser(view("ada_writes", { source: "fxtwitter" }), reader))) as Error
    expect(error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("account_only") })
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toHaveLength(3)
  })
})
