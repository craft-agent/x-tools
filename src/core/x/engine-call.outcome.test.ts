import { describe, expect, test } from "bun:test"
import { isToolError } from "../errors"
import { engineOutcome, type EngineFailureKind, type EngineReply, type EngineSession } from "./engine-call"
import { BASE_REPLY } from "./engine-call.testing"

const NOW = Date.parse("2030-06-01T12:00:00Z")
const PAST = "2030-06-01T11:59:59+00:00"
const FUTURE = "2030-06-01T15:30:00+02:00"
const FUTURE_ISO = "2030-06-01T13:30:00.000Z"

function failure(
  kind: EngineFailureKind,
  extra: { error?: string; session?: EngineSession | null; contacted?: boolean } = {},
): EngineReply {
  return { ...BASE_REPLY, ok: false, kind, error: extra.error ?? "something happened.", contacted: true, ...extra }
}

function outcome(reply: EngineReply) {
  try {
    engineOutcome(reply, NOW)
  } catch (error) {
    if (isToolError(error)) return error
    throw error
  }
  throw new Error("expected a ToolError")
}

describe("engineOutcome", () => {
  test("an ok reply is its data, and any data goes through", () => {
    expect(engineOutcome({ ...BASE_REPLY, ok: true, data: { a: [1] } })).toEqual({ a: [1] })
    expect(engineOutcome({ ...BASE_REPLY, ok: true, data: null })).toBeNull()
  })

  test("setup is unauthenticated", () => {
    const error = outcome(failure("setup", { error: "ct0 is missing." }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe("The reading account's cookies are not usable: ct0 is missing.")
    expect(error.details).toEqual({ kind: "setup", contacted: true })
  })

  test("refused is unauthenticated with the reason", () => {
    const error = outcome(failure("refused", { contacted: false }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe("X refused this reading account's session; sign in again with fresh cookies.")
    expect(error.details).toEqual({ reason: "refused", kind: "refused", contacted: false })
  })

  test("no_account with a lock in the future is rate_limited until the latest lock", () => {
    const session = { active: true, error: null, locks: { UserTweets: "2030-06-01T12:30:00+00:00", Search: FUTURE } }
    const error = outcome(failure("no_account", { session }))
    expect(error.code).toBe("rate_limited")
    expect(error.message).toBe(`X is rate-limiting the reading account until ${FUTURE_ISO}.`)
    expect(error.details).toEqual({ until: FUTURE_ISO, kind: "no_account", contacted: true })
  })

  test("no_account with only past locks falls through to the session's state", () => {
    const session = { active: true, error: null, locks: { UserTweets: PAST } }
    const error = outcome(failure("no_account", { session }))
    expect(error.code).toBe("upstream_error")
    expect(error.details).toEqual({ kind: "no_account", contacted: true })
  })

  test("no_account with an inactive session is unauthenticated with the session's error", () => {
    const session = { active: false, error: "Could not authenticate", locks: {} }
    const error = outcome(failure("no_account", { session }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe("X refused this reading account's session: Could not authenticate.")
    expect(error.details).toEqual({ reason: "refused", kind: "no_account", contacted: true })
  })

  test("no_account with a past lock and an inactive session is unauthenticated", () => {
    const session = { active: false, error: "Could not authenticate", locks: { UserTweets: PAST } }
    expect(outcome(failure("no_account", { session })).code).toBe("unauthenticated")
  })

  test("a future lock wins over an inactive session", () => {
    const session = { active: false, error: "Could not authenticate", locks: { UserTweets: FUTURE } }
    expect(outcome(failure("no_account", { session })).code).toBe("rate_limited")
  })

  test("no_account without a session, or with an unreadable lock, is upstream_error", () => {
    expect(outcome(failure("no_account")).code).toBe("upstream_error")
    const session = { active: true, error: null, locks: { UserTweets: "not a time" } }
    expect(outcome(failure("no_account", { session })).code).toBe("upstream_error")
  })

  test("timeout is upstream_error", () => {
    const error = outcome(failure("timeout"))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("X did not answer in time.")
    expect(error.details).toEqual({ kind: "timeout", contacted: true })
  })

  test("x_error and parse_error are upstream_error with the engine's words", () => {
    const xError = outcome(failure("x_error", { error: "HTTP 403" }))
    expect(xError.code).toBe("upstream_error")
    expect(xError.message).toBe("X answered with an error: HTTP 403.")
    const parseError = outcome(failure("parse_error", { error: "no data" }))
    expect(parseError.code).toBe("upstream_error")
    expect(parseError.message).toBe("X's answer could not be read: no data.")
  })

  test("invalid_request is internal_error, and error is upstream_error", () => {
    expect(outcome(failure("invalid_request", { contacted: false })).code).toBe("internal_error")
    expect(outcome(failure("error", { error: "oops" })).code).toBe("upstream_error")
  })

  test("every failure's details carry its kind and contacted", () => {
    const kinds: EngineFailureKind[] = [
      "invalid_request",
      "setup",
      "refused",
      "no_account",
      "timeout",
      "x_error",
      "parse_error",
      "error",
    ]
    for (const kind of kinds) {
      expect(outcome(failure(kind, { contacted: kind === "timeout" })).details).toMatchObject({
        kind,
        contacted: kind === "timeout",
      })
    }
  })

  test("a message holds the reply's masked words and nothing of the cookies", () => {
    const error = outcome(failure("x_error", { error: "bad [masked] for [masked]" }))
    expect(error.message).toBe("X answered with an error: bad [masked] for [masked].")
  })
})
