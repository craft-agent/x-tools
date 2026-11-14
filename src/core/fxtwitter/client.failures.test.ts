import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isToolError } from "../errors"
import { MAX_FAILURES_IN_A_ROW } from "./client"
import { clientFixture, type ClientFixture } from "./client.testing"
import { T0, iso, rejected } from "./fxtwitter.testing"

let fx: ClientFixture

beforeEach(async () => {
  fx = await clientFixture()
})

afterEach(() => fx.dispose())

describe("a 429", () => {
  test("starts the cooldown from Retry-After and throws rate_limited", async () => {
    fx.fake.route("/2/status/1", { status: 429, headers: { "Retry-After": "120" }, body: { code: 429 } })
    const client = fx.client()
    const error = await rejected(client.get("/2/status/1"))
    expect(isToolError(error) && error.code).toBe("rate_limited")
    expect(isToolError(error) && error.details).toEqual({
      source: "fxtwitter",
      reason: "fxtwitter_429",
      retry_at: iso(T0 + 120_000),
    })
    expect(client.failures()).toBe(1)
    expect(await fx.state()).toEqual({ calls: [T0], cooldown_until: iso(T0 + 120_000) })
  })

  test("without Retry-After takes the cooldown setting", async () => {
    fx.fake.route("/2/status/1", { status: 429, body: {} })
    await rejected(fx.client().get("/2/status/1"))
    expect((await fx.state()).cooldown_until).toBe(iso(T0 + 900_000))
  })

  test("makes the next client refuse without a request, until the cooldown ends", async () => {
    fx.fake.route("/2/status/1", { status: 429, headers: { "Retry-After": "120" }, body: {} })
    await rejected(fx.client().get("/2/status/1"))

    const second = await rejected(fx.client().get("/2/status/1"))
    expect(isToolError(second) && second.code).toBe("rate_limited")
    expect(isToolError(second) && second.details).toEqual({
      source: "fxtwitter",
      reason: "fxtwitter_cooldown",
      retry_at: iso(T0 + 120_000),
    })
    expect(fx.fake.requests).toHaveLength(1)

    fx.clock.time = T0 + 120_000
    fx.fake.route("/2/status/1", { status: 200, body: {} })
    expect((await fx.client().get("/2/status/1")).status).toBe(200)
    expect(fx.fake.requests).toHaveLength(2)
  })
})

describe("failures in a row", () => {
  test("a 5xx throws upstream_error with its status", async () => {
    fx.fake.route("/2/status/1", { status: 503, body: {} })
    const error = await rejected(fx.client().get("/2/status/1"))
    expect(isToolError(error) && error.code).toBe("upstream_error")
    expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "server_error", status: 503 })
  })

  test("the fourth request refuses without sending after three 5xx", async () => {
    fx.fake.route("/2/status/1", { status: 500, body: {} })
    const client = fx.client()
    for (let attempt = 0; attempt < MAX_FAILURES_IN_A_ROW; attempt++) await rejected(client.get("/2/status/1"))
    expect(client.failures()).toBe(MAX_FAILURES_IN_A_ROW)

    const error = await rejected(client.get("/2/status/1"))
    expect(isToolError(error) && error.code).toBe("upstream_error")
    expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "fxtwitter_failing" })
    expect(fx.fake.requests).toHaveLength(MAX_FAILURES_IN_A_ROW)
    expect((await fx.state()).calls).toHaveLength(MAX_FAILURES_IN_A_ROW)
  })

  test("timeouts count as failures", async () => {
    fx.fake.route("/2/status/1", { status: 200, body: {}, delayMs: 2_000 })
    const client = fx.client({ timeoutMs: 30 })
    for (let attempt = 0; attempt < MAX_FAILURES_IN_A_ROW; attempt++) {
      const error = await rejected(client.get("/2/status/1"))
      expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "timeout" })
    }
    const error = await rejected(client.get("/2/status/1"))
    expect(isToolError(error) && error.details?.reason).toBe("fxtwitter_failing")
    expect(fx.fake.requests).toHaveLength(MAX_FAILURES_IN_A_ROW)
  })

  test("network failures count as failures, and every attempt is counted as a request", async () => {
    await fx.fake.stop()
    const client = fx.client()
    for (let attempt = 0; attempt < MAX_FAILURES_IN_A_ROW; attempt++) {
      const error = await rejected(client.get("/2/status/1"))
      expect(isToolError(error) && error.details).toEqual({ source: "fxtwitter", reason: "network" })
    }
    const error = await rejected(client.get("/2/status/1"))
    expect(isToolError(error) && error.details?.reason).toBe("fxtwitter_failing")
    expect((await fx.state()).calls).toHaveLength(MAX_FAILURES_IN_A_ROW)
  })

  test("another client of the same call starts clean, as a new tool call would", async () => {
    fx.fake.route("/2/status/1", { status: 500, body: {} })
    const client = fx.client()
    for (let attempt = 0; attempt < MAX_FAILURES_IN_A_ROW; attempt++) await rejected(client.get("/2/status/1"))
    fx.fake.route("/2/status/1", { status: 200, body: {} })
    expect(fx.client().failures()).toBe(0)
    expect((await fx.client().get("/2/status/1")).status).toBe(200)
  })

  test("a success resets the count, so failures never reach the limit", async () => {
    const client = fx.client()
    for (let round = 0; round < 3; round++) {
      fx.fake.route("/2/status/1", { status: 500, body: {} })
      await rejected(client.get("/2/status/1"))
      await rejected(client.get("/2/status/1"))
      expect(client.failures()).toBe(2)
      fx.fake.route("/2/status/1", { status: 200, body: {} })
      expect((await client.get("/2/status/1")).status).toBe(200)
      expect(client.failures()).toBe(0)
    }
  })
})
