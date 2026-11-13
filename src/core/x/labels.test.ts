import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "../errors"
import { DEFAULT_LABEL, checkLabel, isLabel, labelPaths, listLabels, stateRoot } from "./labels"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xlabels-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function failure(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe("isLabel and checkLabel", () => {
  const valid = [DEFAULT_LABEL, "a", "0", "work_2", "a_b", "a" + "0".repeat(22) + "b", "a".repeat(24)]
  const invalid = [
    "",
    "a".repeat(25),
    "Work",
    "A",
    "DEFAULT",
    "_work",
    "work_",
    "_",
    "work-1",
    "work.1",
    "work/1",
    "work 1",
    "..",
  ]

  test("accepts valid labels", () => {
    for (const label of valid) {
      expect(isLabel(label)).toBe(true)
      expect(checkLabel(label)).toBe(label)
    }
  })

  test("refuses invalid labels with invalid_argument", () => {
    for (const label of invalid) {
      expect(isLabel(label)).toBe(false)
      const error = failure(() => checkLabel(label))
      expect(isToolError(error) && error.code).toBe("invalid_argument")
    }
  })

  test("states the rule and clips a long bad label", () => {
    const error = failure(() => checkLabel("A".repeat(50)))
    expect((error as Error).message).toBe(
      `Invalid label "${"A".repeat(40)}…": a label must be 1 to 24 lowercase letters, digits and "_", starting and ending with a letter or digit.`,
    )
  })
})

describe("stateRoot and labelPaths", () => {
  test("stateRoot names one directory per role", () => {
    const root = join(tempDir, "state")
    expect(stateRoot(root)).toEqual({
      root,
      accounts: join(root, "accounts"),
      engine: join(root, "engine"),
      fxtwitter: join(root, "fxtwitter"),
    })
  })

  test("a relative state directory is an internal_error", () => {
    const error = failure(() => stateRoot("relative/state"))
    expect(isToolError(error) && error.code).toBe("internal_error")
    expect(isToolError(failure(() => labelPaths("relative/state", "work")))).toBe(true)
  })

  test("labelPaths keeps the label's files in accounts/<label>", () => {
    const dir = join(tempDir, "state", "accounts", "work")
    expect(labelPaths(join(tempDir, "state"), "work")).toEqual({
      label: "work",
      dir,
      cookies: join(dir, "cookies"),
      lock: join(dir, "read.lock"),
      pacing: join(dir, "pacing.json"),
    })
  })

  test("labelPaths refuses a bad label", () => {
    const error = failure(() => labelPaths(tempDir, "Bad"))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
  })
})

describe("listLabels", () => {
  test("is empty when the state root or accounts/ does not exist", async () => {
    expect(await listLabels(join(tempDir, "missing"))).toEqual([])
    mkdirSync(join(tempDir, "state"))
    expect(await listLabels(join(tempDir, "state"))).toEqual([])
  })

  test("is empty when accounts/ is a file", async () => {
    mkdirSync(join(tempDir, "state"))
    writeFileSync(join(tempDir, "state", "accounts"), "")
    expect(await listLabels(join(tempDir, "state"))).toEqual([])
  })

  test("returns sorted labels, skipping files, symlinks and invalid names", async () => {
    const accounts = join(tempDir, "state", "accounts")
    mkdirSync(accounts, { recursive: true })
    for (const name of ["zebra", "apple", "middle", "UPPERCASE", "with-hyphen", "_leading"]) {
      mkdirSync(join(accounts, name))
    }
    writeFileSync(join(accounts, "file_label"), "data")
    mkdirSync(join(tempDir, "target"))
    symlinkSync(join(tempDir, "target"), join(accounts, "symlink_dir"))

    expect(await listLabels(join(tempDir, "state"))).toEqual(["apple", "middle", "zebra"])
  })

  test("ignores the siblings of accounts/", async () => {
    const state = join(tempDir, "state")
    for (const name of ["grants", "engine", "fxtwitter", "accounts/work"]) {
      mkdirSync(join(state, name), { recursive: true })
    }
    expect(await listLabels(state)).toEqual(["work"])
  })
})
