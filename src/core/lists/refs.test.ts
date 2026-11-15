import { describe, expect, test } from "bun:test"
import { parseListRef } from "./refs"

describe("parseListRef", () => {
  test("takes an id, whitespace around it ignored", () => {
    expect(parseListRef("20")).toBe("20")
    expect(parseListRef("  1234567890123456789  ")).toBe("1234567890123456789")
    expect(parseListRef("1".repeat(20))).toBe("1".repeat(20))
  })

  test("takes the URL of a list on x.com or twitter.com, with its prefixes, more path, a query or a fragment", () => {
    for (const url of [
      "https://x.com/i/lists/20",
      "http://twitter.com/i/lists/20",
      "https://www.x.com/i/lists/20/",
      "https://mobile.twitter.com/i/lists/20/members",
      "https://x.com/i/lists/20?s=1",
      "https://x.com/i/lists/20#top",
      " https://x.com/i/lists/20/members?s=1#a ",
    ]) {
      expect(parseListRef(url)).toBe("20")
    }
  })

  test("refuses anything else, naming the argument and never echoing the input", () => {
    for (const input of [
      "",
      "SECRET",
      "12a",
      "1".repeat(21),
      "ftp://x.com/i/lists/20?SECRET",
      "https://example.test/i/lists/20?SECRET",
      "https://x.com/i/lists/SECRET",
      "https://x.com/i/lists/",
      "https://x.com/i/lists/20SECRET",
      "https://x.com/ada/lists/20",
      "https://x.com/ada/status/20",
      "https://notx.com/i/lists/20",
    ]) {
      expect(() => parseListRef(input, "where")).toThrow(
        expect.objectContaining({
          code: "invalid_argument",
          message: "where is not a list id or a list URL on x.com or twitter.com.",
        }),
      )
    }
  })

  test("names the list by default", () => {
    expect(() => parseListRef("x")).toThrow(expect.objectContaining({ message: expect.stringMatching(/^list is not/) }))
  })
})
