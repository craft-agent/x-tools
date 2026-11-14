import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isToolError } from "../errors"
import { TEST_USER_AGENT, startFakeFxTwitter, rejected, type FakeFxTwitter } from "./fxtwitter.testing"
import { MAX_REDIRECTS, fxGet } from "./transport"

let fake: FakeFxTwitter

beforeEach(async () => {
  fake = await startFakeFxTwitter()
})

afterEach(async () => {
  await fake.stop()
})

const get = (path = "/2/status/1") => fxGet(path, { userAgent: TEST_USER_AGENT, connect: fake.connect })

function redirectTo(location: string, status = 302) {
  return { status, headers: { Location: location } }
}

async function expectRefused(location: string): Promise<void> {
  fake.route("/2/status/1", redirectTo(location))
  const error = await rejected(get())
  expect(isToolError(error) && error.code).toBe("upstream_error")
  expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "redirect" })
  expect(fake.requests.map((request) => request.path)).toEqual(["/2/status/1"])
}

describe("fxGet redirects", () => {
  test("follows an absolute and a relative redirect within the host", async () => {
    fake.route("/2/status/1", redirectTo("https://api.fxtwitter.com/2/status/2", 301))
    fake.route("/2/status/2", redirectTo("/2/status/3", 308))
    fake.route("/2/status/3", { status: 200, body: { done: true } })
    expect(await get()).toEqual({ status: 200, retryAfter: null, body: { done: true } })
    expect(fake.requests.map((request) => request.path)).toEqual(["/2/status/1", "/2/status/2", "/2/status/3"])
    expect(new Set(fake.hosts)).toEqual(new Set(["api.fxtwitter.com"]))
  })

  test("follows as many redirects as it allows", async () => {
    for (let hop = 1; hop <= MAX_REDIRECTS; hop++) {
      fake.route(`/2/hop/${hop}`, redirectTo(`https://api.fxtwitter.com/2/hop/${hop + 1}`))
    }
    fake.route(`/2/hop/${MAX_REDIRECTS + 1}`, { status: 200, body: { end: true } })
    expect((await get("/2/hop/1")).body).toEqual({ end: true })
  })

  test("refuses one redirect more than it allows", async () => {
    for (let hop = 1; hop <= MAX_REDIRECTS + 1; hop++) {
      fake.route(`/2/hop/${hop}`, redirectTo(`https://api.fxtwitter.com/2/hop/${hop + 1}`))
    }
    fake.route(`/2/hop/${MAX_REDIRECTS + 2}`, { status: 200, body: {} })
    const error = await rejected(get("/2/hop/1"))
    expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "redirect" })
    expect(fake.requests).toHaveLength(MAX_REDIRECTS + 1)
  })

  test("refuses a redirect to another host", () => expectRefused("https://example.com/2/status/2"))

  test("refuses a redirect to a host that only starts with the name", () =>
    expectRefused("https://api.fxtwitter.com.example.com/2/status/2"))

  test("refuses a redirect to http", () => expectRefused("http://api.fxtwitter.com/2/status/2"))

  test("refuses a redirect to another port", () => expectRefused("https://api.fxtwitter.com:8443/2/status/2"))

  test("refuses a redirect outside /2/", () => expectRefused("https://api.fxtwitter.com/status/2"))

  test("refuses a redirect without a Location", async () => {
    fake.route("/2/status/1", { status: 302 })
    const error = await rejected(get())
    expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "redirect" })
  })
})
