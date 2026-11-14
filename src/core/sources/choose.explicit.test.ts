import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { removeTempDirs } from "../x/engine.testing"
import { readX } from "../x/read"
import { readFromSources } from "./choose"
import { answers, recordingRead, sourcesFixture, type SourcesFixture } from "./sources.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

describe("readFromSources with source fxtwitter", () => {
  test("reads FxTwitter only, and an answer is returned as FxTwitter's", async () => {
    await h.label()
    const { read, calls } = recordingRead(answers("from fxtwitter"))
    expect(await readFromSources(h.reader(), "fxtwitter", read)).toEqual({
      source: "fxtwitter",
      value: "from fxtwitter",
    })
    expect(calls).toEqual({ fxtwitter: 1, account: 0 })
  })

  test("a fallback's value is FxTwitter's answer, and the reading account is not asked", async () => {
    await h.label()
    const { read, calls } = recordingRead(async () => ({ kind: "fallback", reason: "protected", value: "private" }))
    expect(await readFromSources(h.reader(), "fxtwitter", read)).toEqual({ source: "fxtwitter", value: "private" })
    expect(calls.account).toBe(0)
  })

  test("FxTwitter's errors propagate, with a reading account set up", async () => {
    await h.label()
    const down = new ToolError("upstream_error", "down", { details: { source: "fxtwitter" } })
    const { read, calls } = recordingRead(async () => {
      throw down
    })
    expect(await rejected(readFromSources(h.reader(), "fxtwitter", read))).toBe(down)
    expect(calls.account).toBe(0)
  })

  test("under account_only it is invalid_argument naming the setting, before anything is read", async () => {
    const { read, calls } = recordingRead(answers("from fxtwitter"))
    const error = await rejected(readFromSources(h.reader({ account_only: true }), "fxtwitter", read))
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect((error as ToolError).message).toContain("account_only")
    expect(calls).toEqual({ fxtwitter: 0, account: 0 })
    expect(h.fake.requests).toEqual([])
  })

  test("for a read FxTwitter does not offer it is invalid_argument, and nothing is read", async () => {
    await h.label()
    const { read, calls } = recordingRead()
    const error = await rejected(readFromSources(h.reader(), "fxtwitter", read))
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: "FxTwitter does not offer this read; use source auto or account.",
    })
    expect(calls).toEqual({ fxtwitter: 0, account: 0 })
  })
})

describe("readFromSources with source account", () => {
  test("reads the reading account only, whatever FxTwitter offers", async () => {
    await h.label()
    const { read, calls } = recordingRead(answers("from fxtwitter"))
    expect(await readFromSources(h.reader(), "account", read)).toEqual({ source: "account", value: "account" })
    expect(calls).toEqual({ fxtwitter: 0, account: 1 })
    expect(h.fake.requests).toEqual([])
  })

  test("with no reading account set up it is not_found, and FxTwitter is not read", async () => {
    const { read, calls } = recordingRead(answers("from fxtwitter"))
    const reader = h.reader(undefined, { readAccount: readX })
    const error = await rejected(
      readFromSources(reader, "account", {
        ...read,
        account: async (r) => (await r.account("check", {})).account,
      }),
    )
    expect(error).toMatchObject({ code: "not_found", message: "No reading account is set up yet." })
    expect(calls.fxtwitter).toBe(0)
    expect(h.fake.requests).toEqual([])
  })

  test("the reading account's own errors propagate", async () => {
    const failure = new ToolError("unauthenticated", "refused")
    const error = await rejected(
      readFromSources(h.reader(), "account", {
        fxtwitter: answers("from fxtwitter"),
        account: async () => {
          throw failure
        },
      }),
    )
    expect(error).toBe(failure)
  })
})
