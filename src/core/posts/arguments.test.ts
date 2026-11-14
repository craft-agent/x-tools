import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { MAX_LIMIT } from "../sources/page"
import type { Reader } from "../sources/reader"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { conversationOfPost } from "./conversation"
import { accountConversation, accountThread, conversation, thread } from "./conversation.testing"
import { accountPage, mentions, quotes, readerPaging, search } from "./list.testing"
import { mentionsOfAccount } from "./mentions"
import { quotesOfPost } from "./quotes"
import { xPostRead } from "./read"
import { MAX_POST_REF_LENGTH, MAX_QUERY_LENGTH, type PostMethod, type PostReadInput } from "./schemas"
import { searchPosts } from "./search"
import { threadOfPost } from "./thread"
import { timelineOfAccount } from "./timeline"
import { accountTimeline, accountUser, readerTimeline, timeline } from "./timeline.testing"
import { viewPosts } from "./view"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const HANDLERS: Record<PostMethod, (args: PostReadInput, reader: Reader) => Promise<unknown>> = {
  view: viewPosts,
  search: searchPosts,
  quotes: quotesOfPost,
  mentions: mentionsOfAccount,
  conversation: conversationOfPost,
  thread: threadOfPost,
  timeline: timelineOfAccount,
}

/** What each argument carries in these tests; a string holds a marker that no message may repeat. */
const VALUES = {
  posts: ["SECRET"],
  query: "SECRET",
  feed: "top",
  sort: "latest",
  post: "SECRET",
  handle: "SECRET",
  tab: "media",
  since: "SECRET",
  limit: 5,
  cursor: "SECRET",
} as const

/** The call's own arguments that make it valid for each method. */
const VALID: Record<PostMethod, PostReadInput> = {
  view: { method: "view", posts: ["20"] },
  search: search("from:ada"),
  quotes: quotes("20"),
  mentions: mentions("ada"),
  conversation: conversation("20"),
  thread: thread("20"),
  timeline: timeline("ada"),
}

const FOREIGN: Record<PostMethod, (keyof typeof VALUES)[]> = {
  view: ["query", "feed", "sort", "post", "handle", "tab", "since", "limit", "cursor"],
  search: ["posts", "sort", "post", "handle", "tab", "since"],
  quotes: ["posts", "query", "feed", "sort", "handle", "tab", "since"],
  mentions: ["posts", "query", "feed", "sort", "post", "tab"],
  conversation: ["posts", "query", "feed", "handle", "tab", "since", "limit"],
  thread: ["posts", "query", "feed", "sort", "handle", "tab", "since", "limit", "cursor"],
  timeline: ["posts", "query", "feed", "sort", "post", "since"],
}

const REQUIRED: Record<PostMethod, string> = {
  view: "posts",
  search: "query",
  quotes: "post",
  mentions: "handle",
  conversation: "post",
  thread: "post",
  timeline: "handle",
}

/** The error `method` fails with for `args`, after checking that nothing was read. */
async function refusal(args: unknown) {
  const { method } = args as PostReadInput
  const error = await rejected(HANDLERS[method](args as PostReadInput, h.reader()))
  expect(h.fake.requests).toEqual([])
  expect(h.accountReads).toEqual([])
  return error
}

describe("a method's required argument", () => {
  for (const method of Object.keys(HANDLERS) as PostMethod[]) {
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
    const reader = readerPaging(h, accountPage([]))
    await searchPosts(search('  "slow reading"  from:ada ', { source: "account" }), reader)
    expect(h.accountReads[0]!.args).toMatchObject({ query: '  "slow reading"  from:ada ' })
  })
})

describe("an argument the method does not take", () => {
  for (const method of Object.keys(FOREIGN) as PostMethod[]) {
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
    const data = {
      search: accountPage([]),
      quotes: accountPage([]),
      mentions: accountPage([]),
      conversation: accountConversation("20"),
      thread: accountThread(["20"]),
    }
    for (const method of Object.keys(data) as (keyof typeof data)[]) {
      const reader = readerPaging(h, data[method])
      await HANDLERS[method]({ ...VALID[method], source: "account", account: "default" }, reader)
    }
    const answers = { user: accountUser(), timeline: accountTimeline([]) }
    const reader = readerTimeline(h, answers)
    await HANDLERS.timeline({ ...VALID.timeline, source: "account", account: "default" }, reader)
    expect(h.accountReads).toHaveLength(7)
  })
})

describe("the handle and the day of mentions", () => {
  test("a handle that is no handle is refused without echoing it, for mentions and timeline", async () => {
    for (const make of [mentions, timeline]) {
      for (const handle of ["a-b-SECRET", "a".repeat(16), "@@ada", "@", "ada writes SECRET"]) {
        const error = (await refusal(make(handle))) as Error
        expect(error.message).not.toContain("SECRET")
        expect(error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("handle is not") })
      }
    }
  })

  test("a since that is no real calendar day is refused without echoing it", async () => {
    const days = ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-10", "2026-01-32", "0050-01-01", "SECRET"]
    for (const since of [...days, "2026-1-5", "20260105", "2026-01-05T00:00:00", " 2026-01-05", "2026/01/05"]) {
      const error = await refusal(mentions("ada", { since }))
      expect(error).toMatchObject({ code: "invalid_argument", message: "since is not a day written YYYY-MM-DD." })
      expect((error as Error).message).not.toContain("SECRET")
    }
  })

  test("a handle with or without its @ in any case, and a real day, read as one query", async () => {
    await h.label()
    for (const [handle, since] of [
      ["@Ada_Writes", "2026-02-28"],
      ["ada_writes", "2024-02-29"],
    ] as const) {
      await mentionsOfAccount(mentions(handle, { since, source: "account" }), readerPaging(h, accountPage([])))
      expect(h.accountReads.at(-1)!.args).toMatchObject({ query: `@ada_writes -from:ada_writes since:${since}` })
    }
  })

  test("a post that is no post id or URL is refused, naming post", async () => {
    const error = (await refusal(quotes("https://example.com/SECRET"))) as Error
    expect(error.message).not.toContain("SECRET")
    expect(error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("post is not a post id") })
  })
})

describe("the input schema", () => {
  const parses = (args: Record<string, unknown>) => xPostRead.input.strict().safeParse(args).success

  test("every field but method is optional, and the method must be one of seven", () => {
    for (const method of Object.keys(HANDLERS)) expect(parses({ method })).toBe(true)
    expect(parses({ method: "profile" })).toBe(false)
    expect(parses({})).toBe(false)
  })

  test("bounds the query, the post, the handle, the feed and the page", () => {
    expect(parses({ method: "search", query: "x".repeat(MAX_QUERY_LENGTH) })).toBe(true)
    expect(parses({ method: "search", query: "x".repeat(MAX_QUERY_LENGTH + 1) })).toBe(false)
    expect(parses({ method: "quotes", post: "2".repeat(MAX_POST_REF_LENGTH + 1) })).toBe(false)
    expect(parses({ method: "mentions", handle: `@${"a".repeat(15)}` })).toBe(true)
    expect(parses({ method: "mentions", handle: `@${"a".repeat(16)}` })).toBe(false)
    expect(parses({ method: "search", feed: "media" })).toBe(true)
    expect(parses({ method: "search", feed: "oldest" })).toBe(false)
    expect(parses({ method: "conversation", sort: "latest" })).toBe(true)
    expect(parses({ method: "conversation", sort: "oldest" })).toBe(false)
    expect(parses({ method: "timeline", handle: "ada", tab: "replies" })).toBe(true)
    expect(parses({ method: "timeline", handle: "ada", tab: "likes" })).toBe(false)
    for (const limit of [0, MAX_LIMIT + 1, 2.5]) expect(parses({ method: "search", limit })).toBe(false)
    expect(parses({ method: "search", limit: MAX_LIMIT, cursor: "c" })).toBe(true)
  })

  test("describes each field with the methods it belongs to", () => {
    const { shape } = xPostRead.input
    expect(shape.posts.description).toContain("`view`")
    expect(shape.query.description).toContain("`search`")
    expect(shape.feed.description).toContain("`search`")
    for (const method of ["`quotes`", "`conversation`", "`thread`"]) expect(shape.post.description).toContain(method)
    expect(shape.sort.description).toContain("`conversation`")
    expect(shape.handle.description).toContain("`mentions` and `timeline`")
    expect(shape.tab.description).toContain("`timeline`")
    expect(shape.since.description).toContain("`mentions`")
    expect(shape.limit.description).toContain("`search`, `quotes`, `mentions` and `timeline`")
    expect(shape.limit.description).not.toContain("`conversation`")
    expect(shape.cursor.description).toContain("`search`, `quotes`, `mentions`, `conversation` and `timeline`")
  })
})
