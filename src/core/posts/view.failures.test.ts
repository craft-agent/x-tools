import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { abortError } from "../exec"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { accountPostData, readerAnswering, requested, routePost, statusPath, view } from "./view.testing"
import { viewPosts } from "./view"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const HOUR_CAP = new ToolError("rate_limited", "This reading account has used its 30 reads for this hour.", {
  details: { reason: "hourly_cap", retry_at: "2026-01-01T00:40:00.000Z" },
})

describe("viewPosts: a post that could not be read", () => {
  test("a spent call budget leaves the rest not_read with the budget as the reason", async () => {
    await h.label()
    const reader = readerAnswering(h, {}, undefined, {
      budgetMs: 1000,
      readAccount: async () => {
        h.clock.time += 1000
        return { account: "default", data: accountPostData("20") }
      },
    })
    const { posts } = await viewPosts(view(["20", "21", "22"], { source: "account" }), reader)
    expect(posts.map((post) => post.status)).toEqual(["ok", "not_read", "not_read"])
    expect(posts[1]).toMatchObject({
      source: null,
      reason: "call_budget",
      retry_at: null,
      error: "rate_limited: This call ran out of its time before it could read this; ask again for what is left.",
      post: null,
    })
    expect(posts[2]).toMatchObject({ status: "not_read", reason: "call_budget" })
  })

  test("a spent budget stops the requests to FxTwitter too", async () => {
    for (const id of ["20", "21"]) routePost(h, id)
    const { posts } = await viewPosts(view(["20", "21"]), h.reader(undefined, { budgetMs: 0 }))
    expect(posts.map((post) => [post.status, post.reason])).toEqual([
      ["not_read", "call_budget"],
      ["not_read", "call_budget"],
    ])
    expect(h.fake.requests).toEqual([])
  })

  test("a cap of the reading account leaves that post not_read with when to ask again, and the call goes on", async () => {
    await h.label()
    let reads = 0
    const reader = readerAnswering(h, { "21": accountPostData("21") }, undefined, {
      readAccount: async (options) => {
        h.accountReads.push(options)
        reads += 1
        if (reads === 1) throw HOUR_CAP
        return { account: "default", data: accountPostData("21") }
      },
    })
    const { posts } = await viewPosts(view(["20", "21"], { source: "account" }), reader)
    expect(posts[0]).toEqual({
      input: "20",
      id: "20",
      url_handle: null,
      handle_mismatch: false,
      status: "not_read",
      source: null,
      reason: "hourly_cap",
      retry_at: "2026-01-01T00:40:00.000Z",
      error: "rate_limited: This reading account has used its 30 reads for this hour.",
      post: null,
    })
    expect(posts[1]).toMatchObject({ id: "21", status: "ok", source: "account" })
  })

  test("a failure with no reason is told by its code, with no time to ask again", async () => {
    await h.label()
    const reader = readerAnswering(h, {}, undefined, {
      readAccount: async () => {
        throw new ToolError("unauthenticated", "X refused the session.")
      },
    })
    const { posts } = await viewPosts(view(["20"], { source: "account" }), reader)
    expect(posts[0]).toMatchObject({
      status: "not_read",
      reason: "unauthenticated",
      retry_at: null,
      error: "unauthenticated: X refused the session.",
    })
  })

  test("FxTwitter failing with no reading account leaves the post not_read, with FxTwitter's reason", async () => {
    h.fake.route(statusPath("20"), { status: 503 })
    const { posts } = await viewPosts(view(["20"]), h.reader())
    expect(posts[0]).toMatchObject({
      status: "not_read",
      source: null,
      reason: "server_error",
      error: "upstream_error: FxTwitter answered with an error (503).",
    })
  })

  test("an unknown reading account label refuses the call before any request, whatever the source", async () => {
    await h.label("work")
    const reader = readerAnswering(h, {}, undefined, {
      readAccount: async () => {
        throw new Error("must not be called")
      },
    })
    const error = await rejected(viewPosts(view(["20"], { account: "other" }), reader))
    expect(error).toMatchObject({ code: "not_found" })
    expect(h.fake.requests).toHaveLength(0)
  })

  test("a label that is not one refuses the call", async () => {
    await h.label("work")
    const error = await rejected(viewPosts(view(["20"], { account: "Not A Label" }), readerAnswering(h, {})))
    expect(error).toMatchObject({ code: "invalid_argument" })
  })
})

describe("viewPosts: what ends the call", () => {
  test("an abort propagates", async () => {
    await h.label()
    const controller = new AbortController()
    controller.abort()
    const reader = readerAnswering(h, {}, undefined, {
      readAccount: async () => {
        throw abortError(controller.signal)
      },
    })
    expect(await rejected(viewPosts(view(["20", "21"], { source: "account" }), reader))).toMatchObject({
      name: "AbortError",
    })
  })

  test("an internal_error propagates", async () => {
    await h.label()
    const reader = readerAnswering(h, {}, undefined, {
      readAccount: async () => {
        throw new ToolError("internal_error", "A bug.")
      },
    })
    expect(await rejected(viewPosts(view(["20"], { source: "account" }), reader))).toMatchObject({
      code: "internal_error",
    })
  })
})

describe("viewPosts: what is checked before anything is read", () => {
  test("an entry that is no post refuses the call, naming its position, before any request", async () => {
    await h.label()
    routePost(h, "20")
    const reader = readerAnswering(h, {})
    expect(await rejected(viewPosts(view(["20", "https://example.com/a/status/21"]), reader))).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("posts[1] "),
    })
    expect(requested(h)).toEqual([])
    expect(h.accountReads).toEqual([])
  })

  test("source fxtwitter under account_only is refused with the choice's message, before any request", async () => {
    await h.label()
    const reader = readerAnswering(h, {}, { account_only: true })
    expect(await rejected(viewPosts(view(["20"], { source: "fxtwitter" }), reader))).toMatchObject({
      code: "invalid_argument",
      message:
        "FxTwitter is turned off by the account_only setting; use source auto or account, or turn the setting off.",
    })
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })

  test("source account with no reading account set up is refused as not_found, before any read", async () => {
    const reader = readerAnswering(h, { "20": accountPostData("20") })
    expect(await rejected(viewPosts(view(["20"], { source: "account" }), reader))).toMatchObject({
      code: "not_found",
      message: "No reading account is set up yet.",
      details: { known_accounts: [] },
    })
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })

  test("any source under account_only with no reading account set up is refused the same way", async () => {
    for (const source of [undefined, "auto", "account"] as const) {
      const reader = readerAnswering(h, {}, { account_only: true })
      expect(await rejected(viewPosts(view(["20"], { source }), reader))).toMatchObject({
        code: "not_found",
        message: "No reading account is set up yet.",
      })
    }
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })
})
