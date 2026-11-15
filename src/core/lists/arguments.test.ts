import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { MAX_LIMIT } from "../sources/page"
import type { Reader } from "../sources/reader"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { listMembersPage, listPostsPage, members, posts, readerLists } from "./lists.testing"
import { listMembers } from "./members"
import { listPosts } from "./posts"
import { MAX_LIST_REF_LENGTH, listReadInput, type ListMethod, type ListReadInput } from "./schemas"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const HANDLERS: Record<ListMethod, (args: ListReadInput, reader: Reader) => Promise<unknown>> = {
  posts: listPosts,
  members: listMembers,
}

const METHODS = Object.keys(HANDLERS) as ListMethod[]

/** The error `args` fails with, after checking that nothing was read. */
async function refusal(args: unknown) {
  const error = await rejected(HANDLERS[(args as ListReadInput).method](args as ListReadInput, h.reader()))
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error
}

describe("a method's required argument", () => {
  for (const method of METHODS) {
    test(`${method} names list when it is left out`, async () => {
      expect(await refusal({ method })).toMatchObject({
        code: "invalid_argument",
        message: `list is required by ${method}.`,
      })
    })
  }

  test("a list that is no list is refused without echoing it", async () => {
    for (const method of METHODS) {
      for (const list of ["SECRET", "https://example.test/i/lists/20?SECRET", "12a", "1".repeat(21)]) {
        const error = (await refusal({ method, list })) as Error
        expect(error.message).not.toContain("SECRET")
        expect(error).toMatchObject({
          code: "invalid_argument",
          message: "list is not a list id or a list URL on x.com or twitter.com.",
        })
      }
    }
  })
})

describe("the arguments every method takes", () => {
  test("limit, cursor, source and account belong to both methods", async () => {
    await h.label()
    const reader = readerLists(h, { list_posts: listPostsPage([]), list_members: listMembersPage([]) })
    await listPosts(posts("20", { source: "account", account: "default", limit: 5 }), reader)
    await listMembers(members("20", { source: "account", account: "default", limit: 5 }), reader)
    expect(h.accountReads.map(({ op }) => op)).toEqual(["list_posts", "list_members"])
  })
})

describe("the input schema", () => {
  const parses = (args: Record<string, unknown>) => listReadInput.strict().safeParse(args).success

  test("every field but method is optional, and the method must be one of two", () => {
    for (const method of METHODS) expect(parses({ method })).toBe(true)
    expect(parses({ method: "likes" })).toBe(false)
    expect(parses({})).toBe(false)
  })

  test("bounds the list and the page, and refuses an argument it does not know", () => {
    for (const method of METHODS) {
      expect(parses({ method, list: "1".repeat(MAX_LIST_REF_LENGTH) })).toBe(true)
      expect(parses({ method, list: "1".repeat(MAX_LIST_REF_LENGTH + 1) })).toBe(false)
      for (const limit of [0, MAX_LIMIT + 1, 2.5]) expect(parses({ method, limit })).toBe(false)
      expect(parses({ method, limit: MAX_LIMIT, cursor: "c" })).toBe(true)
      expect(parses({ method, handle: "ada" })).toBe(false)
    }
  })

  test("describes the list, the limit and the cursor", () => {
    const { shape } = listReadInput
    expect(shape.list.description).toContain("x.com/i/lists/<id>")
    expect(shape.limit.description).toContain("Both methods")
    expect(shape.cursor.description).toContain("Both methods")
  })
})
