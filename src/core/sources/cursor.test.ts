import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { decodeCursor, encodeCursor, type CursorExpectation } from "./cursor"
import { ANSWERERS, type Answerer } from "./source"
import { thrown } from "./sources.testing"

const READ = "search"

const expectation = (extra: Partial<CursorExpectation> = {}): CursorExpectation => ({
  read: READ,
  accountOnly: false,
  ...extra,
})

const own = (source: Answerer, cursor = "abc") => encodeCursor({ source, read: READ, cursor })

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url")

describe("encodeCursor and decodeCursor", () => {
  test("a cursor is base64url of compact JSON that carries its version, source, read and own cursor", () => {
    const text = own("fxtwitter", "DAABCgABG")
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.parse(Buffer.from(text, "base64url").toString("utf8"))).toEqual({
      v: 1,
      s: "fxtwitter",
      r: READ,
      c: "DAABCgABG",
    })
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
      base64url({ v: 2, s: "account", r: READ, c: "x" }),
      base64url({ v: 1, s: "other", r: READ, c: "x" }),
      base64url({ v: 1, s: "account", r: 1, c: "x" }),
      base64url({ v: 1, s: "account", r: READ }),
      base64url({ v: 1, s: "account", r: READ, c: "x", extra: true }),
      `${own("account")}=`,
      `${own("account")}%`,
    ]
    for (const text of malformed) {
      expect(refused(text)).toMatchObject({ code: "invalid_argument" })
      expect((refused(text) as Error).message).toContain("malformed")
    }
  })

  test("another read's cursor", () => {
    const text = encodeCursor({ source: "account", read: "timeline", cursor: "abc" })
    expect(refused(text)).toMatchObject({ code: "invalid_argument" })
    expect((refused(text) as Error).message).toContain("another read")
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

  test("every refusal says that a cursor continues only on the source and read that gave it", () => {
    for (const error of [refused("x!"), refused(own("fxtwitter"), { source: "account" })]) {
      expect((error as Error).message).toContain("a cursor continues only on the source and read that gave it")
    }
  })
})
