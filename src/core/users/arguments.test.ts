import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { MAX_POST_REF_LENGTH, MAX_QUERY_LENGTH } from "../posts/schemas"
import { MAX_LIMIT } from "../sources/page"
import type { Reader } from "../sources/reader"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { readFollows } from "./follows"
import { repostersOfPost } from "./reposters"
import { userReadInput, type UserMethod, type UserReadInput } from "./schemas"
import { searchUsers } from "./search"
import { accountProfile, accountUsersPage, follows, readerUsers, reposters, search, view } from "./users.testing"
import { viewUser } from "./view"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const HANDLERS: Record<UserMethod, (args: UserReadInput, reader: Reader) => Promise<unknown>> = {
  view: viewUser,
  search: searchUsers,
  followers: readFollows("followers"),
  following: readFollows("following"),
  reposters: repostersOfPost,
}

/** What each argument carries in these tests; a string holds a marker that no message may repeat. */
const VALUES = { handle: "SECRET", query: "SECRET", post: "SECRET", limit: 5, cursor: "SECRET" } as const

/** The call's own arguments that make it valid for each method. */
const VALID: Record<UserMethod, UserReadInput> = {
  view: view("ada"),
  search: search("slow reading"),
  followers: follows("followers", "ada"),
  following: follows("following", "ada"),
  reposters: reposters("20"),
}

const FOREIGN: Record<UserMethod, (keyof typeof VALUES)[]> = {
  view: ["query", "post", "limit", "cursor"],
  search: ["handle", "post"],
  followers: ["query", "post"],
  following: ["query", "post"],
  reposters: ["handle", "query"],
}

const REQUIRED: Record<UserMethod, string> = {
  view: "handle",
  search: "query",
  followers: "handle",
  following: "handle",
  reposters: "post",
}

/** The error `args` fails with, after checking that nothing was read. */
async function refusal(args: unknown) {
  const { method } = args as UserReadInput
  const error = await rejected(HANDLERS[method](args as UserReadInput, h.reader()))
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error
}

describe("a method's required argument", () => {
  for (const method of Object.keys(HANDLERS) as UserMethod[]) {
    test(`${method} names ${REQUIRED[method]} when it is left out`, async () => {
      expect(await refusal({ method })).toMatchObject({
        code: "invalid_argument",
        message: `${REQUIRED[method]} is required by ${method}.`,
      })
    })
  }

  test("a query that is blank is refused, and one with words is passed as written", async () => {
    for (const query of ["", "   ", "\n\t"]) {
      expect(await refusal(search(query))).toMatchObject({
        code: "invalid_argument",
        message: "query must not be empty.",
      })
    }
    await h.label()
    await searchUsers(
      search("  slow reading  ", { source: "account" }),
      readerUsers(h, { user_search: accountUsersPage([]) }),
    )
    expect(h.accountReads[0]!.args).toMatchObject({ query: "  slow reading  " })
  })
})

describe("an argument the method does not take", () => {
  for (const method of Object.keys(FOREIGN) as UserMethod[]) {
    for (const name of FOREIGN[method]) {
      test(`${method} refuses ${name}, naming it and not its value`, async () => {
        const error = await refusal({ ...VALID[method], [name]: VALUES[name] })
        expect(error).toMatchObject({ code: "invalid_argument", message: `${name} is not an argument of ${method}.` })
        expect((error as Error).message).not.toContain("SECRET")
      })
    }
  }

  test("source and account belong to every method", async () => {
    await h.label()
    const page = accountUsersPage([])
    const reader = readerUsers(h, { user: accountProfile(), user_search: page, follows: page, reposters: page })
    for (const method of Object.keys(HANDLERS) as UserMethod[]) {
      await HANDLERS[method]({ ...VALID[method], source: "account", account: "default" }, reader)
    }
    expect(h.accountReads.map(({ op }) => op)).toEqual(["user", "user_search", "follows", "follows", "reposters"])
  })

  test("a handle that is no handle is refused without echoing it", async () => {
    for (const method of ["view", "followers", "following"] as const) {
      for (const handle of ["a-b-SECRET", "a".repeat(16), "@@ada", "@", "ada writes SECRET"]) {
        const error = (await refusal({ ...VALID[method], handle })) as Error
        expect(error.message).not.toContain("SECRET")
        expect(error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("handle is not") })
      }
    }
  })

  test("a post that is no post is refused without echoing it", async () => {
    for (const post of ["SECRET", "https://example.test/status/20?SECRET", "12a", "1".repeat(21)]) {
      const error = (await refusal(reposters(post))) as Error
      expect(error.message).not.toContain("SECRET")
      expect(error).toMatchObject({
        code: "invalid_argument",
        message: "post is not a post id or a post URL on x.com, twitter.com or an FxTwitter mirror.",
      })
    }
  })
})

describe("the input schema", () => {
  const parses = (args: Record<string, unknown>) => userReadInput.strict().safeParse(args).success

  test("every field but method is optional, and the method must be one of five", () => {
    for (const method of Object.keys(HANDLERS)) expect(parses({ method })).toBe(true)
    expect(parses({ method: "likes" })).toBe(false)
    expect(parses({})).toBe(false)
  })

  test("bounds the query, the handle, the post and the page", () => {
    expect(parses({ method: "search", query: "x".repeat(MAX_QUERY_LENGTH) })).toBe(true)
    expect(parses({ method: "search", query: "x".repeat(MAX_QUERY_LENGTH + 1) })).toBe(false)
    for (const method of ["view", "followers", "following"]) {
      expect(parses({ method, handle: `@${"a".repeat(15)}` })).toBe(true)
      expect(parses({ method, handle: `@${"a".repeat(16)}` })).toBe(false)
    }
    expect(parses({ method: "reposters", post: "1".repeat(MAX_POST_REF_LENGTH) })).toBe(true)
    expect(parses({ method: "reposters", post: "1".repeat(MAX_POST_REF_LENGTH + 1) })).toBe(false)
    for (const method of ["search", "followers", "following", "reposters"]) {
      for (const limit of [0, MAX_LIMIT + 1, 2.5]) expect(parses({ method, limit })).toBe(false)
      expect(parses({ method, limit: MAX_LIMIT, cursor: "c" })).toBe(true)
    }
    expect(parses({ method: "search", extra: 1 })).toBe(false)
  })

  test("describes each field with the methods it belongs to", () => {
    const { shape } = userReadInput
    for (const method of ["`view`", "`followers`", "`following`"]) expect(shape.handle.description).toContain(method)
    expect(shape.query.description).toContain("`search`")
    expect(shape.post.description).toContain("`reposters`")
    for (const method of ["`search`", "`followers`", "`following`", "`reposters`"]) {
      expect(shape.limit.description).toContain(method)
      expect(shape.cursor.description).toContain(method)
    }
  })
})
