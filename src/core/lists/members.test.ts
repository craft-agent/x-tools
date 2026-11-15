import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { unexpectedMatch } from "../posts/posts.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { LIST_NOT_FOUND_MESSAGE } from "./account"
import { asked, cursorOf, listMembersPage, members, readerLists } from "./lists.testing"
import { listMembers } from "./members"
import { UNTRUSTED_NOTE, listReadOutput } from "./schemas"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ARGS = { list: "20" }
const ANSWERS = { list_members: listMembersPage(["ada", "grace"], "ACC2") }

describe("list members through the reading account", () => {
  test("asks the bridge's list_members operation with the id, the limit as count and the bridge's own cursor", async () => {
    await listMembers(members("20", { limit: 7 }), readerLists(h, ANSWERS))
    const cursor = cursorOf("account", ARGS, "ACC1", "list_members")
    await listMembers(members("https://x.com/i/lists/20", { cursor }), readerLists(h, ANSWERS))
    const args = (count: number, own: string | null) => ({ op: "list_members", args: { id: "20", count, cursor: own } })
    expect(asked(h)).toEqual([args(7, null), args(20, "ACC1")])
    expect(h.fake.requests).toEqual([])
  })

  test("returns the bridge's users in its order, with read_at and the cursor for this read", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const result = await listMembers(members("20"), readerLists(h, ANSWERS))
    expect(result).toEqual({
      method: "members",
      users: [
        expect.objectContaining({ handle: "ada", read_at: "2026-03-04T05:06:07Z" }),
        expect.objectContaining({ handle: "grace" }),
      ],
      source: "account",
      cursor: cursorOf("account", ARGS, "ACC2", "list_members"),
      note: UNTRUSTED_NOTE,
    })
    expect(listReadOutput.parse(result)).toEqual(result)
    expect((await listMembers(members("20", { limit: 1 }), readerLists(h, ANSWERS))).users).toHaveLength(1)
  })

  test("data null is a list the reading account cannot see", async () => {
    expect(await rejected(listMembers(members("20"), readerLists(h, { list_members: null })))).toMatchObject({
      code: "not_found",
      message: LIST_NOT_FOUND_MESSAGE,
    })
  })

  test("data off the operation's shape is an unexpected reply of the account", async () => {
    for (const page of [undefined, "none", { users: "none" }, { users: [{ id: "4001" }] }]) {
      const read = listMembers(members("20"), readerLists(h, { list_members: page }))
      expect(await rejected(read)).toMatchObject(unexpectedMatch("account"))
    }
  })
})

describe("list members and FxTwitter", () => {
  test("source fxtwitter is refused before any read or request", async () => {
    const read = listMembers(members("20", { source: "fxtwitter" }), readerLists(h, ANSWERS))
    expect(await rejected(read)).toMatchObject({ code: "invalid_argument" })
    expect(h.accountReads).toEqual([])
    expect(h.fake.requests).toEqual([])
  })

  test("auto reads the account and never asks FxTwitter, under account_only as well", async () => {
    for (const options of [undefined, { account_only: true }]) {
      expect(await listMembers(members("20"), readerLists(h, ANSWERS, options))).toMatchObject({ source: "account" })
    }
    expect(h.fake.requests).toEqual([])
  })
})
