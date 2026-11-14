import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "../errors"
import { ensureLabelDir } from "./labels"
import { ensurePrivateDir } from "./private-dir"

let tempDir: string
let state: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xdirs-"))
  state = join(tempDir, "state")
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function mode(path: string): number {
  return statSync(path).mode & 0o777
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return undefined
}

describe("ensurePrivateDir", () => {
  test("creates the directory and its missing parents with mode 700", async () => {
    const dir = join(tempDir, "a", "b", "c")
    await ensurePrivateDir(dir)
    expect(mode(dir)).toBe(0o700)
    expect(mode(join(tempDir, "a"))).toBe(0o700)
  })

  test("sets an existing permissive directory to 700 and leaves its content", async () => {
    const dir = join(tempDir, "open")
    mkdirSync(dir, { mode: 0o755 })
    chmodSync(dir, 0o755)
    writeFileSync(join(dir, "kept"), "x")
    await ensurePrivateDir(dir)
    expect(mode(dir)).toBe(0o700)
    expect(statSync(join(dir, "kept")).isFile()).toBe(true)
  })

  test("refuses a file and names the path", async () => {
    const path = join(tempDir, "file")
    writeFileSync(path, "x")
    const error = await failure(() => ensurePrivateDir(path))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
    expect((error as Error).message).toContain(path)
  })

  test("refuses a symlink to a directory without following it", async () => {
    const real = join(tempDir, "real")
    mkdirSync(real, { mode: 0o755 })
    chmodSync(real, 0o755)
    const link = join(tempDir, "link")
    symlinkSync(real, link)
    const error = await failure(() => ensurePrivateDir(link))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
    expect((error as Error).message).toContain(link)
    expect(mode(real)).toBe(0o755)
  })

  test("refuses a dangling symlink", async () => {
    const link = join(tempDir, "dangling")
    symlinkSync(join(tempDir, "nowhere"), link)
    const error = await failure(() => ensurePrivateDir(link))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
  })
})

describe("ensureLabelDir", () => {
  test("creates the root, accounts/ and the label directory with mode 700", async () => {
    const paths = await ensureLabelDir(join(tempDir, "sub", "state"), "work")
    expect(paths.dir).toBe(join(tempDir, "sub", "state", "accounts", "work"))
    for (const dir of [join(tempDir, "sub", "state"), join(tempDir, "sub", "state", "accounts"), paths.dir]) {
      expect(mode(dir)).toBe(0o700)
    }
  })

  test("fixes existing 755 directories to 700", async () => {
    const labelDir = join(state, "accounts", "work")
    mkdirSync(labelDir, { recursive: true })
    for (const dir of [state, join(state, "accounts"), labelDir]) chmodSync(dir, 0o755)

    await ensureLabelDir(state, "work")

    for (const dir of [state, join(state, "accounts"), labelDir]) expect(mode(dir)).toBe(0o700)
  })

  test("is repeatable", async () => {
    await ensureLabelDir(state, "work")
    expect((await ensureLabelDir(state, "work")).label).toBe("work")
  })

  test("refuses a symlinked label directory", async () => {
    mkdirSync(join(state, "accounts"), { recursive: true })
    mkdirSync(join(tempDir, "real"))
    symlinkSync(join(tempDir, "real"), join(state, "accounts", "link_label"))
    const error = await failure(() => ensureLabelDir(state, "link_label"))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
  })

  test("refuses a symlinked accounts/ and creates nothing behind it", async () => {
    mkdirSync(state)
    mkdirSync(join(tempDir, "elsewhere"))
    symlinkSync(join(tempDir, "elsewhere"), join(state, "accounts"))
    const error = await failure(() => ensureLabelDir(state, "work"))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
    expect(statSync(join(tempDir, "elsewhere")).isDirectory()).toBe(true)
    expect(() => statSync(join(tempDir, "elsewhere", "work"))).toThrow()
  })

  test("a bad label creates nothing", async () => {
    const error = await failure(() => ensureLabelDir(state, "Bad"))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
    expect(() => statSync(state)).toThrow()
  })
})
