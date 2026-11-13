import { afterEach, describe, expect, test } from "bun:test"
import { stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { removeTempDirs, tempDir } from "./engine.testing"
import { ensureLabelDir } from "./labels"
import { readPacingState, writePacingState, type PacingState } from "./pacing"

afterEach(removeTempDirs)

const EMPTY: PacingState = { calls: [], refused: null, rate_limited_until: null }

const SAVED: PacingState = {
  calls: [1_700_000_000_000, 1_700_000_005_000],
  refused: { fingerprint: "0123456789abcdef", error: "suspended", at: "2026-01-01T00:00:00.000Z" },
  rate_limited_until: "2026-01-01T01:00:00.000Z",
}

async function label() {
  return ensureLabelDir(await tempDir(), "default")
}

describe("readPacingState and writePacingState", () => {
  test("a missing file is the empty state", async () => {
    expect(await readPacingState(await label())).toEqual(EMPTY)
  })

  test("a written state is read back, in a private file", async () => {
    const paths = await label()
    await writePacingState(paths, SAVED)
    expect(await readPacingState(paths)).toEqual(SAVED)
    expect((await stat(paths.pacing)).mode & 0o777).toBe(0o600)
  })

  test("a write replaces the whole state", async () => {
    const paths = await label()
    await writePacingState(paths, SAVED)
    await writePacingState(paths, EMPTY)
    expect(await readPacingState(paths)).toEqual(EMPTY)
  })

  test("a file that is not JSON, or not a state, is the empty state, never an error", async () => {
    const paths = await label()
    for (const text of [
      "",
      "{not json",
      "[]",
      "null",
      '{"calls":"many"}',
      '{"calls":[1,"2"]}',
      '{"refused":{"fingerprint":1}}',
    ]) {
      await writeFile(paths.pacing, text)
      expect(await readPacingState(paths)).toEqual(EMPTY)
    }
  })

  test("a state that leaves a field out gets that field's neutral value", async () => {
    const paths = await label()
    await writeFile(paths.pacing, JSON.stringify({ calls: [5] }))
    expect(await readPacingState(paths)).toEqual({ calls: [5], refused: null, rate_limited_until: null })
  })

  test("a directory where the file should be is the empty state", async () => {
    const paths = await label()
    await writeFile(join(paths.dir, "other"), "")
    expect(await readPacingState({ ...paths, pacing: paths.dir })).toEqual(EMPTY)
  })
})
