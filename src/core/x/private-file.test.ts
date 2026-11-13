import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { removeTempDirs, tempDir } from "./engine.testing"
import { readJsonFile, writePrivateFile } from "./private-file"

afterEach(removeTempDirs)

const OWNER_ONLY = 0o600

describe("writePrivateFile", () => {
  test("writes the content with mode 600", async () => {
    const path = join(await tempDir(), "state.json")
    await writePrivateFile(path, '{"a":1}')
    expect(await readFile(path, "utf8")).toBe('{"a":1}')
    expect((await stat(path)).mode & 0o777).toBe(OWNER_ONLY)
  })

  test("replaces an existing file whole, and makes it private", async () => {
    const dir = await tempDir()
    const path = join(dir, "state.json")
    await writeFile(path, "old content that is longer", { mode: 0o644 })
    await writePrivateFile(path, "new")
    expect(await readFile(path, "utf8")).toBe("new")
    expect((await stat(path)).mode & 0o777).toBe(OWNER_ONLY)
  })

  test("leaves no temporary file behind", async () => {
    const dir = await tempDir()
    await writePrivateFile(join(dir, "state.json"), "x")
    await writePrivateFile(join(dir, "state.json"), "y")
    expect(await readdir(dir)).toEqual(["state.json"])
  })

  test("fails without leaving a temporary file when the target is a directory", async () => {
    const dir = await tempDir()
    await mkdir(join(dir, "state.json"))
    await expect(writePrivateFile(join(dir, "state.json"), "x")).rejects.toThrow()
    expect(await readdir(dir)).toEqual(["state.json"])
  })
})

describe("readJsonFile", () => {
  test("parses the JSON in a file", async () => {
    const path = join(await tempDir(), "state.json")
    await writeFile(path, '{"a":[1,2]}')
    expect(await readJsonFile(path)).toEqual({ a: [1, 2] })
  })

  test("is undefined for a missing file and for text that is not JSON", async () => {
    const dir = await tempDir()
    await writeFile(join(dir, "bad.json"), "{not json")
    expect(await readJsonFile(join(dir, "missing.json"))).toBeUndefined()
    expect(await readJsonFile(join(dir, "bad.json"))).toBeUndefined()
    expect(await readJsonFile(dir)).toBeUndefined()
  })
})
