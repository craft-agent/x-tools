import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isToolError } from "../errors"
import { TEST_USER_AGENT, startFakeFxTwitter, rejected, type FakeFxTwitter } from "./fxtwitter.testing"
import { FX_HOST, fxGet } from "./transport"

let fake: FakeFxTwitter

beforeEach(async () => {
  fake = await startFakeFxTwitter()
})

afterEach(async () => {
  await fake.stop()
})

const get = (path = "/2/status/1", extra: { signal?: AbortSignal; timeoutMs?: number } = {}) =>
  fxGet(path, { userAgent: TEST_USER_AGENT, connect: fake.connect, ...extra })

describe("fxGet", () => {
  test("returns the status and the parsed JSON of a 200", async () => {
    fake.route("/2/status/1", { status: 200, body: { code: 200, tweet: { id: "1" } } })
    expect(await get()).toEqual({ status: 200, retryAfter: null, body: { code: 200, tweet: { id: "1" } } })
  })

  test("an empty body is null", async () => {
    fake.route("/2/status/1", { status: 200 })
    expect((await get()).body).toBeNull()
  })

  test("a body that is not JSON is not_json", async () => {
    fake.route("/2/status/1", { status: 200, body: "<html>nope</html>" })
    const error = await rejected(get())
    expect(isToolError(error) && error.code).toBe("upstream_error")
    expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "not_json" })
  })

  test("a 404 and a 401 with JSON are returned as they are", async () => {
    fake.route("/2/status/404", { status: 404, body: { code: 404, message: "NOT_FOUND" } })
    fake.route("/2/status/401", { status: 401, body: { code: 401, message: "PRIVATE_TWEET" } })
    expect(await get("/2/status/404")).toEqual({
      status: 404,
      retryAfter: null,
      body: { code: 404, message: "NOT_FOUND" },
    })
    expect(await get("/2/status/401")).toEqual({
      status: 401,
      retryAfter: null,
      body: { code: 401, message: "PRIVATE_TWEET" },
    })
  })

  test("a 429 gives its Retry-After as it was sent", async () => {
    fake.route("/2/status/1", { status: 429, headers: { "Retry-After": "120" }, body: { code: 429 } })
    expect(await get()).toMatchObject({ status: 429, retryAfter: "120" })
  })

  test("sends the User-Agent and Accept, no cookie or credential, to api.fxtwitter.com", async () => {
    fake.route("/2/status/1?x=1", { status: 200, body: {} })
    await get("/2/status/1?x=1")
    const [seen] = fake.requests
    expect(seen).toMatchObject({ method: "GET", path: "/2/status/1?x=1" })
    expect(seen!.headers["user-agent"]).toBe(TEST_USER_AGENT)
    expect(seen!.headers.accept).toBe("application/json")
    expect(seen!.headers.cookie).toBeUndefined()
    expect(seen!.headers.authorization).toBeUndefined()
    expect(fake.hosts).toEqual([FX_HOST])
  })

  test("a path outside /2/ is an internal_error and sends nothing", async () => {
    const error = await rejected(get("/status/1"))
    expect(isToolError(error) && error.code).toBe("internal_error")
    expect(fake.requests).toEqual([])
  })
})
