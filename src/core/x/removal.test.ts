import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isToolError, type ErrorCode } from "../errors"
import { COOKIES } from "./cookies.testing"
import { removeTempDirs, tempDir } from "./engine.testing"
import { ensureLabelDir, stateRoot } from "./labels"
import { tryReadLock } from "./read-lock"
import { removeLabel } from "./removal"

afterEach(removeTempDirs)

/** A label directory holding a cookie file, a pacing file and a nested file, as a used account has. */
async function makeLabel(stateDir: string, label: string): Promise<string> {
  const paths = await ensureLabelDir(stateDir, label)
  await writeFile(paths.cookies, COOKIES, { mode: 0o600 })
  await writeFile(paths.pacing, "{}")
  await writeFile(paths.userIds, "{}")
  await mkdir(join(paths.dir, "nested"))
  await writeFile(join(paths.dir, "nested", "file"), "x")
  return paths.dir
}

async function codeOf(run: () => Promise<unknown>): Promise<ErrorCode> {
  try {
    await run()
  } catch (error) {
    if (isToolError(error)) return error.code
    throw error
  }
  throw new Error("expected the call to throw")
}

describe("removeLabel", () => {
  test("removes the whole label and nothing beside it, leaving no detached copy", async () => {
    const stateDir = await tempDir()
    await makeLabel(stateDir, "work")
    const other = await makeLabel(stateDir, "other")
    await mkdir(stateRoot(stateDir).engine)

    await removeLabel({ stateDir, label: "work" })

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual(["other"])
    expect(await readFile(join(other, "cookies"), "utf8")).toBe(COOKIES)
    expect((await readdir(stateDir)).sort()).toEqual(["accounts", "engine"])
  })

  test("takes a label whose files cannot be read", async () => {
    const stateDir = await tempDir()
    const dir = await makeLabel(stateDir, "work")
    await chmod(join(dir, "cookies"), 0o000)

    await removeLabel({ stateDir, label: "work" })

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual([])
  })

  test("can be repeated for a label that was set up again", async () => {
    const stateDir = await tempDir()
    await makeLabel(stateDir, "work")
    await removeLabel({ stateDir, label: "work" })
    await makeLabel(stateDir, "work")

    await removeLabel({ stateDir, label: "work" })

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual([])
  })

  test("refuses a missing label", async () => {
    const stateDir = await tempDir()
    await makeLabel(stateDir, "work")

    expect(await codeOf(() => removeLabel({ stateDir, label: "absent" }))).toBe("not_found")
    expect(await readdir(stateRoot(stateDir).accounts)).toEqual(["work"])
  })

  test("refuses an invalid label", async () => {
    const stateDir = await tempDir()
    const dir = await makeLabel(stateDir, "work")

    expect(await codeOf(() => removeLabel({ stateDir, label: "../work" }))).toBe("invalid_argument")
    expect(await codeOf(() => removeLabel({ stateDir, label: "Work" }))).toBe("invalid_argument")
    expect((await stat(dir)).isDirectory()).toBe(true)
  })

  test("refuses a symlink and a plain file, leaving the symlink's target alone", async () => {
    const stateDir = await tempDir()
    await ensureLabelDir(stateDir, "work")
    const { accounts } = stateRoot(stateDir)
    const target = join(await tempDir(), "target")
    await mkdir(target)
    await writeFile(join(target, "keep"), "x")
    await symlink(target, join(accounts, "linked"))
    await writeFile(join(accounts, "plain"), "x")

    expect(await codeOf(() => removeLabel({ stateDir, label: "linked" }))).toBe("invalid_argument")
    expect(await codeOf(() => removeLabel({ stateDir, label: "plain" }))).toBe("invalid_argument")
    expect(await readdir(target)).toEqual(["keep"])
    expect((await readdir(accounts)).sort()).toEqual(["linked", "plain", "work"])
  })

  test("leaves the state while a read holds the lock, and removes it once the read ends", async () => {
    const stateDir = await tempDir()
    const dir = await makeLabel(stateDir, "work")
    const release = tryReadLock(join(dir, "read.lock"))!
    try {
      expect(await codeOf(() => removeLabel({ stateDir, label: "work" }))).toBe("invalid_argument")
      expect(await readdir(stateRoot(stateDir).accounts)).toEqual(["work"])
      expect(await readFile(join(dir, "cookies"), "utf8")).toBe(COOKIES)
    } finally {
      release()
    }

    await removeLabel({ stateDir, label: "work" })

    expect(await readdir(stateRoot(stateDir).accounts)).toEqual([])
  })
})

describe("removeLabel when deleting fails", () => {
  // Root ignores directory permissions, so nothing blocks the deletion there.
  test.skipIf(process.getuid?.() === 0)("names the detached directory and does not put it back", async () => {
    const stateDir = await tempDir()
    const dir = await makeLabel(stateDir, "work")
    const nested = join(dir, "nested")
    await chmod(nested, 0o500)
    try {
      let error: unknown
      try {
        await removeLabel({ stateDir, label: "work" })
      } catch (caught) {
        error = caught
      }
      if (!isToolError(error)) throw new Error("expected a ToolError")
      const { accounts } = stateRoot(stateDir)
      const detached = (await readdir(accounts)).find((name) => name.startsWith(".removed-work-"))
      expect(error.code).toBe("upstream_error")
      expect(detached).toBeDefined()
      expect(error.message).toContain(join(accounts, detached!))
      expect((await readdir(accounts)).includes("work")).toBe(false)
      await chmod(join(accounts, detached!, "nested"), 0o700)
    } finally {
      await chmod(nested, 0o700).catch(() => {})
    }
  })
})
