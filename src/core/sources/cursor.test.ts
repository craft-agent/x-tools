import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { decodeCursor, encodeCursor, type CursorExpectation, type CursorParts } from "./cursor"
import { ANSWERERS, type Answerer } from "./source"
import { thrown } from "./sources.testing"

const READ = "search"

const ARGS = { query: "from:ada", feed: "latest" }

const expectation = (extra: Partial<CursorExpectation> = {}): CursorExpectation => ({
  read: READ,
  args: ARGS,
  accountOnly: false,
  ...extra,
})

const own = (source: Answerer, cursor = "abc", args: CursorParts["args"] = ARGS) =>
  encodeCursor({ source, read: READ, args, cursor })

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url")

describe("encodeCursor and decodeCursor", () => {
  test("a cursor is base64url of compact JSON that carries its version, source, read, arguments digest and own cursor", () => {
    const text = own("fxtwitter", "DAABCgABG")
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/)
    const body = JSON.parse(Buffer.from(text, "base64url").toString("utf8"))
    expect(body).toEqual({
      v: 1,
      s: "fxtwitter",
      r: READ,
      a: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      c: "DAABCgABG",
    })
    expect(body.a).not.toContain("from:ada")
  })

  test("round trips for each source, with any characters in the own cursor", () => {
    for (const source of ANSWERERS) {
      for (const cursor of ["abc", "", 'a "quoted" cursor/with+symbols=', "日本語 🙂"]) {
        expect(decodeCursor(own(source, cursor), expectation())).toEqual({ source, cursor })
      }
    }
  })

  test("with auto, or no source, the cursor's own source wins", () => {
    expect(decodeCursor(own("fxtwitter"), expectation({ source: "auto" }))).toMatchObject({ source: "fxtwitter" })
    expect(decodeCursor(own("account"), expectation({ source: "auto" }))).toMatchObject({ source: "account" })
    expect(decodeCursor(own("account"), expectation())).toMatchObject({ source: "account" })
  })

  test("an explicit source that is the cursor's is accepted", () => {
    expect(decodeCursor(own("fxtwitter"), expectation({ source: "fxtwitter" }))).toMatchObject({ source: "fxtwitter" })
    expect(decodeCursor(own("account"), expectation({ source: "account" }))).toMatchObject({ source: "account" })
  })
})

describe("decodeCursor refuses what it did not give", () => {
  const refused = (text: string, extra?: Partial<CursorExpectation>) =>
    thrown(() => decodeCursor(text, expectation(extra)))

  test("anything malformed, saying so", () => {
    const malformed = [
      "",
      "not a cursor!",
      "!!!!",
      Buffer.from("not json").toString("base64url"),
      base64url("text"),
      base64url(null),
      base64url([1]),
      base64url({ v: 2, s: "account", r: READ, a: "x", c: "x" }),
      base64url({ v: 1, s: "other", r: READ, a: "x", c: "x" }),
      base64url({ v: 1, s: "account", r: 1, a: "x", c: "x" }),
      base64url({ v: 1, s: "account", r: READ, a: "x" }),
      base64url({ v: 1, s: "account", r: READ, c: "x" }),
      base64url({ v: 1, s: "account", r: READ, a: 1, c: "x" }),
      base64url({ v: 1, s: "account", r: READ, a: "x", c: "x", extra: true }),
      `${own("account")}=`,
      `${own("account")}%`,
    ]
    for (const text of malformed) {
      expect(refused(text)).toMatchObject({ code: "invalid_argument" })
      expect((refused(text) as Error).message).toContain("malformed")
    }
  })

  test("another read's cursor", () => {
    const text = encodeCursor({ source: "account", read: "timeline", args: ARGS, cursor: "abc" })
    expect(refused(text)).toMatchObject({ code: "invalid_argument" })
    expect((refused(text) as Error).message).toContain("another read")
  })

  test("the same read's cursor with other arguments", () => {
    const text = own("account", "abc", { query: "from:grace", feed: "latest" })
    expect(refused(text)).toMatchObject({ code: "invalid_argument" })
    expect((refused(text) as Error).message).toContain("same read with other arguments")
  })

  test("a cursor of the other source when the source is explicit, naming both", () => {
    const fromFxtwitter = refused(own("fxtwitter"), { source: "account" })
    expect(fromFxtwitter).toMatchObject({ code: "invalid_argument" })
    expect((fromFxtwitter as Error).message).toContain("came from FxTwitter")
    expect((fromFxtwitter as Error).message).toContain("source is account")

    const fromAccount = refused(own("account"), { source: "fxtwitter" })
    expect(fromAccount).toMatchObject({ code: "invalid_argument" })
    expect((fromAccount as Error).message).toContain("came from the reading account")
  })

  test("a FxTwitter cursor under account_only, naming the setting", () => {
    for (const source of [undefined, "auto", "account"] as const) {
      const error = refused(own("fxtwitter"), { source, accountOnly: true })
      expect(error).toMatchObject({ code: "invalid_argument" })
      expect((error as Error).message).toMatch(/FxTwitter/)
    }
    expect((refused(own("fxtwitter"), { accountOnly: true }) as Error).message).toContain("account_only")
    expect(decodeCursor(own("account"), expectation({ accountOnly: true }))).toMatchObject({ source: "account" })
  })

  test("every refusal says that a cursor continues only on the source, read and arguments that gave it", () => {
    const otherArgs = own("account", "abc", { query: "other" })
    for (const error of [refused("x!"), refused(own("fxtwitter"), { source: "account" }), refused(otherArgs)]) {
      expect((error as Error).message).toContain(
        "a cursor continues only on the source, read and arguments that gave it",
      )
    }
  })
})

describe("a cursor is bound to its arguments", () => {
  const passes = (args: CursorParts["args"], expected: CursorParts["args"]) =>
    thrown(() => decodeCursor(own("account", "abc", args), expectation({ args: expected }))) === undefined

  test("the same arguments in another key order pass, at every depth", () => {
    expect(
      passes({ a: 1, b: { c: [1, { x: 1, y: 2 }], d: "e" } }, { b: { d: "e", c: [1, { y: 2, x: 1 }] }, a: 1 }),
    ).toBe(true)
  })

  test("an argument left undefined is dropped, in an object at any depth", () => {
    expect(passes({ query: "q", tab: undefined }, { query: "q" })).toBe(true)
    expect(passes({ query: "q", nested: { since: undefined } }, { nested: {}, query: "q" })).toBe(true)
  })

  test("a changed, added or dropped argument fails", () => {
    expect(passes({ query: "q", feed: "latest" }, { query: "q", feed: "top" })).toBe(false)
    expect(passes({ query: "q" }, { query: "q", feed: "latest" })).toBe(false)
    expect(passes({ query: "q", feed: "latest" }, { query: "q" })).toBe(false)
  })

  test("a changed value inside nested objects and arrays fails, and so does another order of an array", () => {
    expect(passes({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe(false)
    expect(passes({ a: { b: [1, 2] } }, { a: { b: [2, 1] } })).toBe(false)
    expect(passes({ a: { b: 1 } }, { a: { c: 1 } })).toBe(false)
  })

  test("a value of another type fails", () => {
    expect(passes({ id: "1" }, { id: 1 })).toBe(false)
    expect(passes({ id: null }, { id: "null" })).toBe(false)
  })
})
