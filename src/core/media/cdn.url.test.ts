import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isToolError } from "../errors"
import { MAX_MEDIA_REDIRECTS, originalPhotoUrl, downloadMedia } from "./cdn"
import {
  PHOTO_URL,
  TEST_USER_AGENT,
  file,
  redirect,
  rejected,
  startMediaFixture,
  type MediaFixture,
} from "./media.testing"

let fake: MediaFixture

beforeEach(async () => {
  fake = await startMediaFixture()
})

afterEach(async () => {
  await fake.stop()
})

const HOST_REFUSED = { source: "cdn", reason: "host" }
const REDIRECT_REFUSED = { source: "cdn", reason: "redirect" }

describe("downloadMedia URL checks", () => {
  test.each([
    ["http", "http://pbs.twimg.com/media/AbC.jpg"],
    ["another host", "https://example.com/media/AbC.jpg"],
    ["a host that only starts with the name", "https://pbs.twimg.com.evil.test/media/AbC.jpg"],
    ["a subdomain of a media host", "https://x.pbs.twimg.com/media/AbC.jpg"],
    ["a port", "https://pbs.twimg.com:8443/media/AbC.jpg"],
    ["userinfo", "https://user:secret@pbs.twimg.com/media/AbC.jpg"],
    ["a username alone", "https://user@pbs.twimg.com/media/AbC.jpg"],
    ["something that is no URL", "not a url"],
  ])("refuses %s before any request", async (_name, url) => {
    expect(await fake.detailsOf(fake.download(url))).toEqual(HOST_REFUSED)
    expect(fake.requests).toEqual([])
    expect(await fake.listing()).toEqual([])
  })

  test("takes the hosts it is given instead of its own", async () => {
    fake.route("/media/AbC.jpg", file("image/jpeg", "bytes"))
    const url = "https://cdn.example.test/media/AbC.jpg"
    expect(await fake.detailsOf(fake.download(url))).toEqual(HOST_REFUSED)
    expect((await fake.download(url, "photo", { hosts: ["cdn.example.test"] })).bytes).toBe(5)
  })

  test("an invalid stem is an internal error, before anything", async () => {
    for (const stem of ["", "123", "123-", "a-1", "1-2-3", "../1-2", "1-2.jpg", "1-2\n"]) {
      const error = await rejected(downloadMedia(PHOTO_URL, "photo", fake.dir, stem, { userAgent: TEST_USER_AGENT }))
      expect(isToolError(error) && error.code).toBe("internal_error")
    }
    expect(fake.requests).toEqual([])
  })
})

describe("downloadMedia redirects", () => {
  const OTHER = "https://pbs.twimg.com/media/Other.jpg"

  test("follows an absolute, a relative and a cross-host redirect among the media hosts", async () => {
    fake.route("/media/AbC.jpg?name=orig", redirect(OTHER, 301))
    fake.route("/media/Other.jpg", redirect("/media/Third.jpg", 308))
    fake.route("/media/Third.jpg", redirect("https://video.twimg.com/media/Fourth.jpg", 307))
    fake.route("/media/Fourth.jpg", file("image/png", "png"))
    const result = await fake.download(PHOTO_URL)
    expect(result.path.endsWith("123-1.png")).toBe(true)
    expect(fake.requests.map((request) => request.path)).toEqual([
      "/media/AbC.jpg?name=orig",
      "/media/Other.jpg",
      "/media/Third.jpg",
      "/media/Fourth.jpg",
    ])
  })

  test("follows as many redirects as it allows", async () => {
    for (let hop = 0; hop < MAX_MEDIA_REDIRECTS; hop++) {
      fake.route(`/hop/${hop}`, redirect(`https://pbs.twimg.com/hop/${hop + 1}`))
    }
    fake.route(`/hop/${MAX_MEDIA_REDIRECTS}`, file("image/jpeg", "end"))
    expect((await fake.download("https://pbs.twimg.com/hop/0")).bytes).toBe(3)
    expect(fake.requests).toHaveLength(MAX_MEDIA_REDIRECTS + 1)
  })

  test.each([
    ["another host", "https://example.com/media/x.jpg"],
    ["a lookalike host", "https://pbs.twimg.com.evil.test/media/x.jpg"],
    ["http", "http://pbs.twimg.com/media/x.jpg"],
    ["a port", "https://pbs.twimg.com:8443/media/x.jpg"],
    ["userinfo", "https://user:secret@pbs.twimg.com/media/x.jpg"],
  ])("refuses a redirect to %s without following it", async (_name, location) => {
    fake.route("/media/AbC.jpg?name=orig", redirect(location))
    expect(await fake.detailsOf(fake.download(PHOTO_URL))).toEqual(REDIRECT_REFUSED)
    expect(fake.requests).toHaveLength(1)
  })

  test("refuses a redirect without a Location", async () => {
    fake.route("/media/AbC.jpg?name=orig", (response) => {
      response.writeHead(302, { "Content-Length": "0" })
      response.end()
    })
    expect(await fake.detailsOf(fake.download(PHOTO_URL))).toEqual(REDIRECT_REFUSED)
  })

  test("refuses a chain of redirects longer than the limit", async () => {
    for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS + 1; hop++) {
      fake.route(`/hop/${hop}`, redirect(`https://pbs.twimg.com/hop/${hop + 1}`))
    }
    fake.route(`/hop/${MAX_MEDIA_REDIRECTS + 2}`, file("image/jpeg", "end"))
    expect(await fake.detailsOf(fake.download("https://pbs.twimg.com/hop/0"))).toEqual(REDIRECT_REFUSED)
    expect(fake.requests).toHaveLength(MAX_MEDIA_REDIRECTS + 1)
    expect(await fake.listing()).toEqual([])
  })
})

describe("originalPhotoUrl", () => {
  test.each([
    ["https://pbs.twimg.com/media/AbC.jpg", "https://pbs.twimg.com/media/AbC.jpg?name=orig"],
    ["https://pbs.twimg.com/media/AbC?format=webp&name=small", "https://pbs.twimg.com/media/AbC?format=webp&name=orig"],
    ["https://pbs.twimg.com/media/AbC?name=large&format=png", "https://pbs.twimg.com/media/AbC?name=orig&format=png"],
    ["https://pbs.twimg.com/media/AbC.jpg?name=orig#frag", "https://pbs.twimg.com/media/AbC.jpg?name=orig"],
    ["https://video.twimg.com/a/b.mp4", "https://video.twimg.com/a/b.mp4"],
    ["https://example.com/media/AbC.jpg", "https://example.com/media/AbC.jpg"],
    ["not a url", "not a url"],
  ])("%s -> %s", (input, expected) => {
    expect(originalPhotoUrl(input)).toBe(expected)
  })
})
