import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clientFixture, type ClientFixture } from "../fxtwitter/client.testing"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { readPostFromFxTwitter } from "./fxtwitter"
import type { PostLookup } from "./shape"
import { POST_ID, READ_AT, READ_AT_MS, fxNote, fxReply, fxStatus, fxTombstone, unexpectedMatch } from "./posts.testing"

const PATH = `/2/status/${POST_ID}`

let h: ClientFixture

beforeEach(async () => {
  h = await clientFixture()
})

afterEach(async () => {
  await h.dispose()
})

function reply(status: number, body?: unknown, headers?: Record<string, string>): void {
  h.fake.route(PATH, { status, body: body as object, headers })
}

function read(id = POST_ID) {
  return readPostFromFxTwitter(h.client(), id, () => READ_AT_MS)
}

describe("readPostFromFxTwitter: what FxTwitter answers", () => {
  test("a post is stamped with the time the clock tells when the reply arrives", async () => {
    reply(200, fxReply(200, fxStatus({ community_note: fxNote("Context.") })))
    expect((await read()).value).toMatchObject({
      post: { read_at: READ_AT, community_note: { status: "shown", text: "Context." } },
    })
  })

  test("a post is an answer with the post, from /2/status/<id>", async () => {
    reply(200, fxReply(200, fxStatus()))
    const outcome = await read()
    expect(outcome.kind).toBe("answer")
    expect(outcome.value).toMatchObject({ status: "ok", post: { id: POST_ID, text: "Notes on reading slowly." } })
    expect(h.fake.requests.map((request) => `${request.method} ${request.path}`)).toEqual([`GET ${PATH}`])
  })

  test("a deleted post is a final not_found with its reason", async () => {
    reply(404, fxReply(404, fxTombstone("deleted")))
    expect(await read()).toEqual({ kind: "answer", value: { status: "not_found", reason: "deleted" } })
  })

  test("a suspended author's post is a final not_found with its reason", async () => {
    reply(404, fxReply(404, fxTombstone("suspended")))
    expect(await read()).toEqual({ kind: "answer", value: { status: "not_found", reason: "suspended" } })
  })

  test("a bare 404 is a final not_found, which is also how a failed fetch looks", async () => {
    reply(404, fxReply(404, null))
    expect(await read()).toEqual({ kind: "answer", value: { status: "not_found", reason: "not_found" } })
  })

  test("a 401 is protected, for the reading account to try", async () => {
    reply(401, fxReply(401, null))
    expect(await read()).toEqual({
      kind: "fallback",
      reason: "protected",
      value: { status: "protected", reason: "protected" },
    })
  })

  test("a 401 is protected whatever its body holds", async () => {
    reply(401, "")
    expect(await read()).toMatchObject({ kind: "fallback", reason: "protected" })
  })

  test("a private post is protected, for the reading account to try", async () => {
    reply(404, fxReply(404, fxTombstone("private")))
    expect(await read()).toEqual({
      kind: "fallback",
      reason: "protected",
      value: { status: "protected", reason: "private" },
    })
  })

  test("a blocked post is unavailable to a reader that is signed out, for the reading account to try", async () => {
    reply(404, fxReply(404, fxTombstone("blocked")))
    expect(await read()).toEqual({
      kind: "fallback",
      reason: "logged_out",
      value: { status: "unavailable", reason: "blocked" },
    })
  })

  test("an unavailable post is unavailable to a reader that is signed out, for the reading account to try", async () => {
    reply(404, fxReply(404, fxTombstone("unavailable")))
    expect(await read()).toEqual({
      kind: "fallback",
      reason: "logged_out",
      value: { status: "unavailable", reason: "unavailable" },
    })
  })
})

describe("readPostFromFxTwitter: what it does not understand", () => {
  const ODD: Record<string, [number, unknown]> = {
    "another status": [403, fxReply(403, null)],
    "a 400": [400, { error: "bad request" }],
    "a 200 with no body": [200, ""],
    "a 200 that is not an object": [200, [1, 2]],
    "a 200 without a status": [200, { code: 200 }],
    "a 200 with a null status": [200, fxReply(200, null)],
    "a 200 whose status is a tombstone": [200, fxReply(200, fxTombstone("deleted"))],
    "a 200 whose status is off shape": [200, fxReply(200, fxStatus({ text: 5 }))],
    "a 404 with no body": [404, ""],
    "a 404 that is not an object": [404, '"gone"'],
    "a 404 without a status": [404, { code: 404 }],
    "a 404 with another tombstone reason": [404, fxReply(404, fxTombstone("age_gated"))],
    "a 404 whose status is a status": [404, fxReply(404, fxStatus())],
    "a 404 whose status is off shape": [404, fxReply(404, { type: "tombstone" })],
  }

  for (const [name, [status, body]] of Object.entries(ODD)) {
    test(`${name} is an unexpected_reply that names the status`, async () => {
      reply(status, body)
      expect(await rejected(read())).toMatchObject(unexpectedMatch("fxtwitter", status))
    })
  }

  test("a status the client throws for is not caught: a 429 is the client's rate_limited", async () => {
    reply(429, { message: "slow down" }, { "Retry-After": "120" })
    expect(await rejected(read())).toMatchObject({
      code: "rate_limited",
      details: { source: "fxtwitter", reason: "fxtwitter_429" },
    })
  })

  test("a 5xx is the client's upstream_error", async () => {
    reply(503, { message: "down" })
    expect(await rejected(read())).toMatchObject({
      code: "upstream_error",
      details: { reason: "server_error", status: 503 },
    })
  })
})

describe("readPostFromFxTwitter: the id", () => {
  test("a value that is not a decimal id is refused before FxTwitter is asked", async () => {
    for (const id of ["", "../1", "1?x=y", "abc", "1".repeat(21)]) {
      expect(await rejected(read(id))).toMatchObject({ code: "invalid_argument" })
    }
    expect(h.fake.requests).toEqual([])
  })

  test("the id goes into the path as given", async () => {
    h.fake.route("/2/status/42", { status: 200, body: fxReply(200, fxStatus({ id: "42" })) })
    const outcome: { value: PostLookup } = await read("42")
    expect(outcome.value).toMatchObject({ status: "ok", post: { id: "42" } })
  })
})
