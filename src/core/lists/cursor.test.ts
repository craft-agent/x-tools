import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { cursorOf, listMembersPage, listPostsPage, members, posts, readerLists } from "./lists.testing"
import { listMembers } from "./members"
import { listPosts } from "./posts"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
  await h.label()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ANSWERS = { list_posts: listPostsPage(["21"]), list_members: listMembersPage(["ada"]) }

/** The message `read` is refused with, after checking that nothing was read. */
async function refused(read: Promise<unknown>) {
  const error = (await rejected(read)) as Error
  expect(error).toMatchObject({ code: "invalid_argument" })
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error.message
}

describe("a list cursor", () => {
  test("of the list's posts is refused by members, and the members' by posts, before any read", async () => {
    const postsCursor = cursorOf("account", { list: "20" }, "B", "list_posts")
    const membersCursor = cursorOf("account", { list: "20" }, "B", "list_members")
    expect(await refused(listMembers(members("20", { cursor: postsCursor }), readerLists(h, ANSWERS)))).toContain(
      "another read",
    )
    expect(await refused(listPosts(posts("20", { cursor: membersCursor }), readerLists(h, ANSWERS)))).toContain(
      "another read",
    )
  })

  test("of another list is refused before any read", async () => {
    const cursor = cursorOf("account", { list: "21" }, "B")
    expect(await refused(listPosts(posts("20", { cursor }), readerLists(h, ANSWERS)))).toContain("other arguments")
  })

  test("of FxTwitter is refused before any read", async () => {
    const cursor = cursorOf("fxtwitter", { list: "20" }, "B")
    await refused(listPosts(posts("20", { cursor }), readerLists(h, ANSWERS)))
    await refused(listPosts(posts("20", { cursor, source: "account" }), readerLists(h, ANSWERS)))
  })

  test("continues for the same list named by URL, with the cursor's own position sent", async () => {
    const cursor = cursorOf("account", { list: "20" }, "B", "list_members")
    const result = await listMembers(members("https://x.com/i/lists/20", { cursor }), readerLists(h, ANSWERS))
    expect(result).toMatchObject({ source: "account", cursor: null })
    expect(h.accountReads.map(({ args }) => args?.cursor)).toEqual(["B"])
  })
})
