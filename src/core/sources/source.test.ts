import { describe, expect, test } from "bun:test"
import { SOURCES, accountOnly, sourceArgument } from "./source"

describe("sourceArgument", () => {
  test("takes auto, fxtwitter and account, and may be left out", () => {
    expect(SOURCES).toEqual(["auto", "fxtwitter", "account"])
    for (const source of SOURCES) expect(sourceArgument.parse(source)).toBe(source)
    expect(sourceArgument.parse(undefined)).toBeUndefined()
    expect(sourceArgument.safeParse("elsewhere").success).toBe(false)
  })

  test("says what each source reads", () => {
    const { description } = sourceArgument
    expect(description).toContain("`auto` (the default) reads FxTwitter first")
    expect(description).toContain("`fxtwitter` reads only FxTwitter")
    expect(description).toContain("`account` reads only the reading account")
  })
})

describe("accountOnly", () => {
  test("is true only for the setting being true", () => {
    expect(accountOnly({ account_only: true })).toBe(true)
    expect(accountOnly({ account_only: false })).toBe(false)
    expect(accountOnly({ account_only: "true" })).toBe(false)
    expect(accountOnly({ account_only: 1 })).toBe(false)
    expect(accountOnly({})).toBe(false)
    expect(accountOnly(undefined)).toBe(false)
  })
})
