import { describe, expect, test } from "bun:test"
import { parseCommunityRef } from "./refs"

describe("parseCommunityRef", () => {
  test("takes an id, whitespace around it ignored", () => {
    expect(parseCommunityRef("20")).toBe("20")
    expect(parseCommunityRef("  1234567890123456789  ")).toBe("1234567890123456789")
    expect(parseCommunityRef("1".repeat(20))).toBe("1".repeat(20))
  })

  test("takes the URL of a community on x.com or twitter.com, with its prefixes, more path, a query or a fragment", () => {
    for (const url of [
      "https://x.com/i/communities/20",
      "http://twitter.com/i/communities/20",
      "https://www.x.com/i/communities/20/",
      "https://mobile.twitter.com/i/communities/20/members",
      "https://x.com/i/communities/20?s=1",
      "https://x.com/i/communities/20#top",
      " https://x.com/i/communities/20/members?s=1#a ",
    ]) {
      expect(parseCommunityRef(url)).toBe("20")
    }
  })

  test("refuses anything else, naming the argument and never echoing the input", () => {
    for (const input of [
      "",
      "SECRET",
      "12a",
      "1".repeat(21),
      "ftp://x.com/i/communities/20?SECRET",
      "https://example.test/i/communities/20?SECRET",
      "https://x.com/i/communities/SECRET",
      "https://x.com/i/communities/",
      "https://x.com/i/communities/20SECRET",
      "https://x.com/i/lists/20",
      "https://x.com/ada/communities/20",
      "https://notx.com/i/communities/20",
    ]) {
      expect(() => parseCommunityRef(input, "where")).toThrow(
        expect.objectContaining({
          code: "invalid_argument",
          message: "where is not a community id or a community URL on x.com or twitter.com.",
        }),
      )
    }
  })

  test("names the community by default", () => {
    expect(() => parseCommunityRef("x")).toThrow(
      expect.objectContaining({ message: expect.stringMatching(/^community is not/) }),
    )
  })
})
