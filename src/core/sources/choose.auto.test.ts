import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { abortError } from "../exec"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { removeTempDirs } from "../x/engine.testing"
import { readFromSources, type FxOutcome } from "./choose"
import { answers, recordingRead, sourcesFixture, type SourcesFixture } from "./sources.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const failsWith = (error: unknown) => async (): Promise<FxOutcome<string>> => {
  throw error
}

describe("readFromSources with source auto: FxTwitter's outcomes", () => {
  test("an answer is returned as FxTwitter's, and a reading account is left alone", async () => {
    await h.label()
    const { read, calls } = recordingRead(answers("a post"))
    expect(await readFromSources(h.reader(), "auto", read)).toEqual({ source: "fxtwitter", value: "a post" })
    expect(await readFromSources(h.reader(), undefined, read)).toEqual({ source: "fxtwitter", value: "a post" })
    expect(calls).toEqual({ fxtwitter: 2, account: 0 })
  })

  test("a final not found is an answer: it does not fall to the reading account", async () => {
    await h.label()
    const { read, calls } = recordingRead(answers("not found"))
    expect(await readFromSources(h.reader(), "auto", read)).toEqual({ source: "fxtwitter", value: "not found" })
    expect(calls.account).toBe(0)
  })

  for (const reason of ["protected", "logged_out"] as const) {
    test(`a fallback (${reason}) goes to the reading account when one is set up`, async () => {
      await h.label()
      const { read, calls } = recordingRead(async () => ({ kind: "fallback", reason, value: "what FxTwitter said" }))
      expect(await readFromSources(h.reader(), "auto", read)).toEqual({ source: "account", value: "account" })
      expect(calls).toEqual({ fxtwitter: 1, account: 1 })
    })

    test(`a fallback (${reason}) stands as FxTwitter's answer when no reading account is set up`, async () => {
      const { read, calls } = recordingRead(async () => ({ kind: "fallback", reason, value: "what FxTwitter said" }))
      expect(await readFromSources(h.reader(), "auto", read)).toEqual({
        source: "fxtwitter",
        value: "what FxTwitter said",
      })
      expect(calls.account).toBe(0)
    })
  }

  test("a read FxTwitter does not offer goes to the reading account, with no request to FxTwitter", async () => {
    const { read, calls } = recordingRead()
    expect(await readFromSources(h.reader(), "auto", read)).toEqual({ source: "account", value: "account" })
    expect(calls.account).toBe(1)
    expect(h.fake.requests).toEqual([])
  })

  test("the reading account's own errors propagate from a fallback", async () => {
    await h.label()
    const failure = new ToolError("rate_limited", "the account is limited")
    const error = await rejected(
      readFromSources(h.reader(), "auto", {
        fxtwitter: async () => ({ kind: "fallback", reason: "protected", value: "private" }),
        account: async () => {
          throw failure
        },
      }),
    )
    expect(error).toBe(failure)
  })
})

describe("readFromSources with source auto: errors that do not fall", () => {
  const cases: [string, () => unknown][] = [
    ["an abort", () => abortError(AbortSignal.abort())],
    ["an internal_error", () => new ToolError("internal_error", "a bug")],
    ["a failure of another source", () => new ToolError("upstream_error", "the engine failed")],
    ["a failure without details", () => new Error("something else")],
    ["the call's budget", () => new ToolError("rate_limited", "no time", { details: { reason: "call_budget" } })],
  ]
  for (const [name, make] of cases) {
    test(`${name} propagates even with a reading account set up`, async () => {
      await h.label()
      const error = make()
      const { read, calls } = recordingRead(failsWith(error))
      expect(await rejected(readFromSources(h.reader(), "auto", read))).toBe(error)
      expect(calls.account).toBe(0)
    })
  }

  test("the budget a call runs out of while FxTwitter is read does not fall", async () => {
    await h.label()
    const reader = h.reader(undefined, { budgetMs: 1000 })
    const { read, calls } = recordingRead(async (client) => {
      h.clock.time += 2000
      await client.get("/2/status/1")
      return { kind: "answer", value: "late" }
    })
    expect(await rejected(readFromSources(reader, "auto", read))).toMatchObject({
      code: "rate_limited",
      details: { reason: "call_budget" },
    })
    expect(calls.account).toBe(0)
    expect(h.fake.requests).toEqual([])
  })
})

describe("readFromSources with source auto under account_only", () => {
  test("reads only the reading account and never runs the FxTwitter function", async () => {
    const { read, calls } = recordingRead(answers("from fxtwitter"))
    const reader = h.reader({ account_only: true })
    expect(await readFromSources(reader, "auto", read)).toEqual({ source: "account", value: "account" })
    expect(await readFromSources(reader, undefined, read)).toEqual({ source: "account", value: "account" })
    expect(await readFromSources(reader, "account", read)).toEqual({ source: "account", value: "account" })
    expect(calls).toEqual({ fxtwitter: 0, account: 3 })
    expect(h.fake.requests).toEqual([])
  })
})
