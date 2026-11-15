import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { removeTempDirs } from "../x/engine.testing"
import { USER_ID_TTL_MS } from "../x/user-ids"
import { sourcesFixture, type SourcesFixture } from "./sources.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

describe("createReader: the handle → user id cache", () => {
  test("remembers an id for the label on the reader's clock, and forgets it after 7 days", async () => {
    await h.label()
    const reader = h.reader()
    expect(await reader.userId("Ada")).toBeNull()
    await reader.rememberUserId("Ada", "4001")
    expect(await reader.userId("ada")).toBe("4001")
    h.clock.time += USER_ID_TTL_MS - 1
    expect(await reader.userId("ada")).toBe("4001")
    h.clock.time += 1
    expect(await reader.userId("ada")).toBeNull()
  })

  test("is shared by the calls that read through the same label, and kept apart between labels", async () => {
    await h.label("work")
    await h.label("other")
    await h.reader().rememberUserId("ada", "4001", "work")
    expect(await h.reader().userId("ada", "work")).toBe("4001")
    expect(await h.reader().userId("ada", "other")).toBeNull()
  })

  test("names the label as a read of it would: none set up, several, or one that is not", async () => {
    expect(await rejected(h.reader().userId("ada"))).toMatchObject({ code: "not_found" })
    await h.label("work")
    await h.label("other")
    expect(await rejected(h.reader().userId("ada"))).toMatchObject({ code: "invalid_argument" })
    expect(await rejected(h.reader().userId("ada", "nowhere"))).toMatchObject({ code: "not_found" })
  })

  test("a cache that cannot be written is no failure", async () => {
    await h.reader().rememberUserId("ada", "4001")
    await h.reader().rememberUserId("ada", "4001", "nowhere")
    await h.label("work")
    await h.label("other")
    await h.reader().rememberUserId("ada", "4001")
    expect(h.accountReads).toEqual([])
  })
})
