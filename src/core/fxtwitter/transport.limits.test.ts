import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isAbortError, isToolError } from "../errors"
import { TEST_USER_AGENT, rejected, startFakeFxTwitter, waitUntil, type FakeFxTwitter } from "./fxtwitter.testing"
import { MAX_REPLY_BYTES, fxGet } from "./transport"

let fake: FakeFxTwitter

beforeEach(async () => {
  fake = await startFakeFxTwitter()
})

afterEach(async () => {
  await fake.stop()
})

const get = (extra: { signal?: AbortSignal; timeoutMs?: number } = {}) =>
  fxGet("/2/status/1", { userAgent: TEST_USER_AGENT, connect: fake.connect, ...extra })

async function expectReason(promise: Promise<unknown>, reason: string): Promise<void> {
  const error = await rejected(promise)
  expect(isToolError(error) && error.code).toBe("upstream_error")
  expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason })
}

describe("fxGet limits", () => {
  test("refuses a reply that announces more than the cap", async () => {
    const body = Buffer.alloc(MAX_REPLY_BYTES + 1, "a")
    fake.route("/2/status/1", { status: 200, headers: { "Content-Length": String(body.length) }, body })
    await expectReason(get(), "too_large")
  })

  test("takes a reply of exactly the cap", async () => {
    const text = JSON.stringify({ pad: "a".repeat(MAX_REPLY_BYTES - 10) })
    const body = Buffer.from(text.padEnd(MAX_REPLY_BYTES, " "))
    fake.route("/2/status/1", { status: 200, body })
    expect((await get()).status).toBe(200)
  })

  test("stops reading a chunked reply past the cap, and the server sees the connection close", async () => {
    const chunk = Buffer.alloc(1024 * 1024, "a")
    fake.route("/2/status/1", {
      status: 200,
      body: { chunks: [chunk, chunk, chunk, chunk, chunk, chunk], chunkDelayMs: 20 },
    })
    await expectReason(get(), "too_large")
    await waitUntil(() => fake.stats.cutOff > 0)
    expect(fake.stats.cutOff).toBe(1)
  })

  test("a request past the time limit is a timeout", async () => {
    fake.route("/2/status/1", { status: 200, body: {}, delayMs: 2_000 })
    await expectReason(get({ timeoutMs: 50 }), "timeout")
    await waitUntil(() => fake.stats.cutOff > 0)
    expect(fake.stats.cutOff).toBe(1)
  })

  test("a reply that stalls halfway is a timeout too", async () => {
    fake.route("/2/status/1", { status: 200, body: { chunks: ['{"a":', "1}"], chunkDelayMs: 2_000 } })
    await expectReason(get({ timeoutMs: 50 }), "timeout")
  })

  test("a connection that cannot be made is a network failure", async () => {
    await fake.stop()
    await expectReason(get(), "network")
  })

  test("a connection cut mid-reply is a network failure", async () => {
    fake.route("/2/status/1", { status: 200, body: { chunks: ['{"a":', "1}"], chunkDelayMs: 100 } })
    const pending = rejected(get())
    await waitUntil(() => fake.requests.length > 0)
    await fake.stop()
    const error = await pending
    expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "network" })
  })

  test("an abort rejects with an AbortError and destroys the request", async () => {
    fake.route("/2/status/1", { status: 200, body: {}, delayMs: 2_000 })
    const controller = new AbortController()
    const pending = rejected(get({ signal: controller.signal }))
    await waitUntil(() => fake.requests.length > 0)
    controller.abort()
    expect(isAbortError(await pending)).toBe(true)
    await waitUntil(() => fake.stats.cutOff > 0)
    expect(fake.stats.cutOff).toBe(1)
  })

  test("an already aborted signal rejects without a request", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(isAbortError(await rejected(get({ signal: controller.signal })))).toBe(true)
    expect(fake.requests).toEqual([])
  })
})
