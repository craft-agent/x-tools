import { describe, expect, test } from "bun:test"
import { thrown } from "../sources/sources.testing"
import { POST_ID } from "./posts.testing"
import { parsePostRef, parsePostRefs } from "./refs"

describe("parsePostRef: ids", () => {
  test("a decimal id of 1 to 20 digits is a post with no handle", () => {
    expect(parsePostRef("20")).toEqual({ id: "20", handle: null })
    expect(parsePostRef(POST_ID)).toEqual({ id: POST_ID, handle: null })
    expect(parsePostRef("1".repeat(20))).toEqual({ id: "1".repeat(20), handle: null })
  })

  test("whitespace around an id or a URL is ignored", () => {
    expect(parsePostRef(`  ${POST_ID}\n`)).toEqual({ id: POST_ID, handle: null })
    expect(parsePostRef(` \thttps://x.com/ada_writes/status/${POST_ID}  `)).toEqual({
      id: POST_ID,
      handle: "ada_writes",
    })
  })
})

describe("parsePostRef: URLs", () => {
  const hosts = ["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com"]

  for (const host of hosts) {
    for (const prefix of ["", "www.", "mobile."]) {
      test(`reads https://${prefix}${host}/<handle>/status/<id>`, () => {
        expect(parsePostRef(`https://${prefix}${host}/ada_writes/status/${POST_ID}`)).toEqual({
          id: POST_ID,
          handle: "ada_writes",
        })
      })
    }
  }

  test("reads http as well as https", () => {
    expect(parsePostRef(`http://twitter.com/ada_writes/status/${POST_ID}`)).toEqual({
      id: POST_ID,
      handle: "ada_writes",
    })
  })

  test("reads the host in any case", () => {
    expect(parsePostRef(`https://X.COM/Ada_Writes/status/${POST_ID}`)).toEqual({ id: POST_ID, handle: "Ada_Writes" })
    expect(parsePostRef(`HTTPS://Mobile.Twitter.Com/ada_writes/status/${POST_ID}`)).toEqual({
      id: POST_ID,
      handle: "ada_writes",
    })
  })

  test("reads /statuses/ like /status/", () => {
    expect(parsePostRef(`https://twitter.com/ada_writes/statuses/${POST_ID}`)).toEqual({
      id: POST_ID,
      handle: "ada_writes",
    })
  })

  test("names no handle for /i/status/ and /i/web/status/", () => {
    expect(parsePostRef(`https://x.com/i/status/${POST_ID}`)).toEqual({ id: POST_ID, handle: null })
    expect(parsePostRef(`https://x.com/i/web/status/${POST_ID}`)).toEqual({ id: POST_ID, handle: null })
    expect(parsePostRef(`https://twitter.com/i/web/status/${POST_ID}/photo/1`)).toEqual({ id: POST_ID, handle: null })
  })

  test("ignores a path after the id, a query and a fragment", () => {
    for (const tail of ["/photo/1", "/video/1", "/", "?s=20&t=abc", "#top", "/photo/1?s=20#top"]) {
      expect(parsePostRef(`https://x.com/ada_writes/status/${POST_ID}${tail}`)).toEqual({
        id: POST_ID,
        handle: "ada_writes",
      })
    }
  })

  test("takes a handle of 1 to 15 characters", () => {
    expect(parsePostRef(`https://x.com/a/status/${POST_ID}`).handle).toBe("a")
    expect(parsePostRef(`https://x.com/${"a".repeat(15)}/status/${POST_ID}`).handle).toBe("a".repeat(15))
  })
})

describe("parsePostRef: what is refused", () => {
  const refused = [
    `https://example.com/ada_writes/status/${POST_ID}`,
    `https://x.com.evil.test/ada_writes/status/${POST_ID}`,
    `http://x.com.evil.test/ada_writes/status/${POST_ID}`,
    `https://evilx.com/ada_writes/status/${POST_ID}`,
    `https://x.com@evil.test/ada_writes/status/${POST_ID}`,
    `ftp://x.com/ada_writes/status/${POST_ID}`,
    `x.com/ada_writes/status/${POST_ID}`,
    "https://x.com/ada_writes/status/",
    "https://x.com/ada_writes/status",
    `https://x.com/ada_writes/status/${POST_ID}abc`,
    `https://x.com/ada_writes/likes/${POST_ID}`,
    `https://x.com/i/status/`,
    `https://x.com/${"a".repeat(16)}/status/${POST_ID}`,
    `https://x.com/ada-writes/status/${POST_ID}`,
    `https://x.com/ada_writes/status/${"1".repeat(21)}`,
    "1".repeat(21),
    "12a",
    "-1",
    "1.5",
    "",
    "   ",
    "not a url",
    "@ada_writes",
  ]

  for (const input of refused) {
    test(`refuses ${JSON.stringify(input)} without echoing it`, () => {
      const error = thrown(() => parsePostRef(input, 3))
      expect(error).toMatchObject({
        code: "invalid_argument",
        message: "posts[3] is not a post id or a post URL on x.com, twitter.com or an FxTwitter mirror.",
      })
      const { message } = error as Error
      for (const piece of [input.trim(), "evil", "abc"]) {
        if (piece !== "") expect(message).not.toContain(piece)
      }
    })
  }

  test("counts the position from 0, the first entry by default", () => {
    expect(thrown(() => parsePostRef("nope"))).toMatchObject({ message: expect.stringContaining("posts[0] ") })
  })
})

describe("parsePostRefs", () => {
  test("keeps the order, the input as given and the handle of each URL", () => {
    expect(parsePostRefs(["21", ` https://x.com/ada_writes/status/20 `, "https://x.com/i/status/22"])).toEqual([
      { input: "21", id: "21", handle: null },
      { input: " https://x.com/ada_writes/status/20 ", id: "20", handle: "ada_writes" },
      { input: "https://x.com/i/status/22", id: "22", handle: null },
    ])
  })

  test("drops a post named again, whatever the way, keeping the first", () => {
    const refs = parsePostRefs([
      "20",
      "21",
      "https://x.com/ada_writes/status/20",
      "https://x.com/grace/status/21",
      "20",
    ])
    expect(refs.map(({ input, id, handle }) => [input, id, handle])).toEqual([
      ["20", "20", null],
      ["21", "21", null],
    ])
  })

  test("refuses the whole list for one bad entry, naming its position", () => {
    expect(thrown(() => parsePostRefs(["20", "21", "nope", "also nope"]))).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("posts[2] "),
    })
  })
})
