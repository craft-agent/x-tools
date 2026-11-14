import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { removeTempDirs } from "../x/engine.testing"
import { encodeCursor } from "./cursor"
import {
  DEFAULT_LIMIT,
  MAX_CURSOR_LENGTH,
  MAX_LIMIT,
  cursorArgument,
  limitArgument,
  readPage,
  type PagedRead,
} from "./page"
import type { Answerer, Source } from "./source"
import { sourcesFixture, type SourcesFixture } from "./sources.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const READ = "search"
const ARGS = { query: "from:ada" }
const LIST = "/2/list"

/** A cursor as `readPage` gives it for `own` on `source`. */
const cursorOf = (source: Answerer, own: string, args: Record<string, unknown> = ARGS, read = READ) =>
  encodeCursor({ source, read, args, cursor: own })

/** The own cursors each source was asked for, in order; `null` is a first page. */
type Asked = { fxtwitter: (string | null)[]; account: (string | null)[] }

/** FxTwitter's reply to a page: its items and the next cursor. */
const fxPage = (items: string[], next: string | null) => ({ status: 200, body: { items, next } })

const pathOf = (cursor: string | null) => (cursor === null ? LIST : `${LIST}?cursor=${cursor}`)

/** A paged read whose FxTwitter part reads `LIST` of the fake and whose account part answers two pages of its own. */
function pagedRead(withFxTwitter = true): { paged: PagedRead<string>; asked: Asked } {
  const asked: Asked = { fxtwitter: [], account: [] }
  const paged: PagedRead<string> = {
    fxtwitter: withFxTwitter
      ? async (client, cursor) => {
          asked.fxtwitter.push(cursor)
          const { body } = await client.get(pathOf(cursor))
          const { items, next } = body as { items: string[]; next: string | null }
          return { kind: "answer", value: { items, cursor: next } }
        }
      : undefined,
    account: async (_reader, cursor) => {
      asked.account.push(cursor)
      return cursor === null ? { items: ["account 1"], cursor: "acc2" } : { items: ["account 2"], cursor: null }
    },
  }
  return { paged, asked }
}

const request = (extra: { source?: Source; cursor?: string } = {}) => ({
  read: READ,
  args: ARGS,
  ...extra,
})

describe("readPage: the first page", () => {
  test("comes from FxTwitter with its next cursor encoded for FxTwitter, this read and these arguments", async () => {
    h.fake.route(LIST, fxPage(["a", "b"], "fx2"))
    const { paged, asked } = pagedRead()
    expect(await readPage(h.reader(), request(), paged)).toEqual({
      source: "fxtwitter",
      items: ["a", "b"],
      cursor: cursorOf("fxtwitter", "fx2"),
    })
    expect(asked).toEqual({ fxtwitter: [null], account: [] })
  })

  test("falls to the reading account when FxTwitter is down, and the cursor is the account's", async () => {
    await h.label()
    h.fake.route(LIST, { status: 503 })
    const { paged, asked } = pagedRead()
    expect(await readPage(h.reader(), request(), paged)).toEqual({
      source: "account",
      items: ["account 1"],
      cursor: cursorOf("account", "acc2"),
    })
    expect(asked).toEqual({ fxtwitter: [null], account: [null] })
  })

  test("goes to the reading account for a read FxTwitter does not offer, with no request to FxTwitter", async () => {
    const { paged, asked } = pagedRead(false)
    expect(await readPage(h.reader(), request(), paged)).toEqual({
      source: "account",
      items: ["account 1"],
      cursor: cursorOf("account", "acc2"),
    })
    expect(asked).toEqual({ fxtwitter: [], account: [null] })
    expect(h.fake.requests).toEqual([])
  })

  test("source account reads only the reading account", async () => {
    const { paged, asked } = pagedRead()
    await readPage(h.reader(), request({ source: "account" }), paged)
    expect(asked).toEqual({ fxtwitter: [], account: [null] })
    expect(h.fake.requests).toEqual([])
  })
})

describe("readPage: a page that carries more than items", () => {
  type Head = { title: string; ancestors: string[] }

  test("passes the fields beside items and cursor through, from either source, with the cursor encoded", async () => {
    const paged: PagedRead<string, Head> = {
      fxtwitter: async () => ({
        kind: "answer",
        value: { title: "from FxTwitter", ancestors: ["root"], items: ["a"], cursor: "fx2" },
      }),
      account: async () => ({ title: "from the account", ancestors: [], items: ["b"], cursor: null }),
    }
    expect(await readPage(h.reader(), request(), paged)).toEqual({
      source: "fxtwitter",
      title: "from FxTwitter",
      ancestors: ["root"],
      items: ["a"],
      cursor: cursorOf("fxtwitter", "fx2"),
    })
    expect(await readPage(h.reader(), request({ source: "account" }), paged)).toEqual({
      source: "account",
      title: "from the account",
      ancestors: [],
      items: ["b"],
      cursor: null,
    })
  })
})

describe("readPage: a cursor continues on the source that gave it", () => {
  test("the next page goes to FxTwitter with its own cursor, and the last page has no cursor", async () => {
    h.fake.route(pathOf("fx2"), fxPage(["c"], null))
    const { paged, asked } = pagedRead()
    expect(await readPage(h.reader(), request({ cursor: cursorOf("fxtwitter", "fx2") }), paged)).toEqual({
      source: "fxtwitter",
      items: ["c"],
      cursor: null,
    })
    expect(asked).toEqual({ fxtwitter: ["fx2"], account: [] })
    expect(h.fake.requests.map((r) => r.path)).toEqual([pathOf("fx2")])
  })

  test("is not taken to the reading account when FxTwitter fails", async () => {
    await h.label()
    h.fake.route(pathOf("fx2"), { status: 503 })
    const { paged, asked } = pagedRead()
    const error = await rejected(readPage(h.reader(), request({ cursor: cursorOf("fxtwitter", "fx2") }), paged))
    expect(error).toMatchObject({ code: "upstream_error", details: { source: "fxtwitter" } })
    expect(asked.account).toEqual([])
  })

  test("an account cursor goes to the reading account even under auto, with no request to FxTwitter", async () => {
    for (const source of [undefined, "auto", "account"] as const) {
      const { paged, asked } = pagedRead()
      const answer = await readPage(h.reader(), request({ source, cursor: cursorOf("account", "acc2") }), paged)
      expect(answer).toEqual({ source: "account", items: ["account 2"], cursor: null })
      expect(asked).toEqual({ fxtwitter: [], account: ["acc2"] })
    }
    expect(h.fake.requests).toEqual([])
  })

  test("an own cursor that is empty counts as the end", async () => {
    const answer = await readPage<string>(h.reader(), request(), {
      account: async () => ({ items: ["only"], cursor: "" }),
    })
    expect(answer).toEqual({ source: "account", items: ["only"], cursor: null })
  })
})

describe("readPage: a cursor that does not hold is refused before any request", () => {
  const refuses = async (cursor: string, extra: { source?: "fxtwitter" | "account"; accountOnly?: boolean } = {}) => {
    const { paged, asked } = pagedRead()
    const { accountOnly, ...rest } = extra
    const reader = h.reader(accountOnly ? { account_only: true } : undefined)
    const error = await rejected(readPage(reader, request({ ...rest, cursor }), paged))
    expect(asked).toEqual({ fxtwitter: [], account: [] })
    expect(h.fake.requests).toEqual([])
    return error
  }

  test("another read's cursor", async () => {
    expect(await refuses(cursorOf("fxtwitter", "fx2", ARGS, "timeline"))).toMatchObject({ code: "invalid_argument" })
  })

  test("the same read's cursor with other arguments", async () => {
    const error = await refuses(cursorOf("fxtwitter", "fx2", { query: "from:grace" }))
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect((error as Error).message).toContain("other arguments")
  })

  test("a FxTwitter cursor under account_only", async () => {
    const error = await refuses(cursorOf("fxtwitter", "fx2"), { accountOnly: true })
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect((error as Error).message).toContain("account_only")
  })

  test("an account cursor under source fxtwitter", async () => {
    expect(await refuses(cursorOf("account", "acc2"), { source: "fxtwitter" })).toMatchObject({
      code: "invalid_argument",
    })
  })

  test("a malformed cursor, and an empty one", async () => {
    for (const cursor of ["not a cursor!", ""]) {
      expect(await refuses(cursor)).toMatchObject({ code: "invalid_argument" })
    }
  })
})

describe("limitArgument and cursorArgument", () => {
  test("limit is a whole number from 1 to the most, and may be left out", () => {
    expect(DEFAULT_LIMIT).toBe(20)
    expect(MAX_LIMIT).toBe(50)
    for (const value of [undefined, 1, 20, 50]) expect(limitArgument.safeParse(value).success).toBe(true)
    for (const value of [0, 51, 2.5, -1, "20"]) expect(limitArgument.safeParse(value).success).toBe(false)
    expect(limitArgument.description).toContain("20 by default")
  })

  test("cursor is a string of bounded length, and may be left out", () => {
    for (const value of [undefined, "", "x".repeat(MAX_CURSOR_LENGTH)]) {
      expect(cursorArgument.safeParse(value).success).toBe(true)
    }
    for (const value of ["x".repeat(MAX_CURSOR_LENGTH + 1), 1])
      expect(cursorArgument.safeParse(value).success).toBe(false)
  })
})
