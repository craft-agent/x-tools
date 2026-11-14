import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "../errors"
import { READ_LOCK_HELD, tryReadLock } from "./read-lock"

let tempDir: string
let lockPath: string
const releases: (() => void)[] = []

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xreadlock-"))
  lockPath = join(tempDir, "read.lock")
})

afterEach(() => {
  for (const release of releases.splice(0)) release()
  rmSync(tempDir, { recursive: true, force: true })
})

/** Tracks even an unexpectedly successful acquisition for teardown. */
function tryTracked(path: string): (() => void) | undefined {
  const release = tryReadLock(path)
  if (release) releases.push(release)
  return release
}

function acquire(path = lockPath): () => void {
  const release = tryTracked(path)
  if (!release) throw new Error("expected the lock to be free")
  return release
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (isToolError(error)) return error.code
    throw error
  }
  throw new Error("expected the call to throw")
}

describe("tryReadLock", () => {
  test("two connections in one process exclude each other", () => {
    const release = acquire()
    expect(tryTracked(lockPath)).toBeUndefined()
    release()
  })

  test("a release lets the lock be taken again, and releasing twice is harmless", () => {
    const release = acquire()
    release()
    const again = acquire()
    release()
    expect(tryTracked(lockPath)).toBeUndefined()
    again()
    acquire()()
  })

  test("the lock file stays in place and empty after a release", () => {
    acquire()()
    expect(existsSync(lockPath)).toBe(true)
    expect(statSync(lockPath).size).toBe(0)
  })

  test("the file is 0600, whether created or already there with a wider mode", () => {
    acquire()()
    expect(statSync(lockPath).mode & 0o777).toBe(0o600)
    rmSync(lockPath)
    writeFileSync(lockPath, "", { mode: 0o644 })
    acquire()()
    expect(statSync(lockPath).mode & 0o777).toBe(0o600)
  })

  test("a missing directory is not_found and is not created", () => {
    const path = join(tempDir, "missing", "read.lock")
    expect(codeOf(() => tryTracked(path))).toBe("not_found")
    expect(existsSync(join(tempDir, "missing"))).toBe(false)
  })

  test("a file that is not a database throws and is not read as a busy lock", () => {
    writeFileSync(lockPath, "stale pid 1234, not a database at all")
    expect(() => tryTracked(lockPath)).toThrow()
    expect(readFileSync(lockPath, "utf8")).toBe("stale pid 1234, not a database at all")
  })

  test("a symlink is refused and its target left alone", () => {
    const target = join(tempDir, "target")
    writeFileSync(target, "keep", { mode: 0o644 })
    symlinkSync(target, lockPath)
    expect(codeOf(() => tryTracked(lockPath))).toBe("invalid_argument")
    expect(readFileSync(target, "utf8")).toBe("keep")
    expect(statSync(target).mode & 0o777).toBe(0o644)
  })

  test("a directory and a hard link are refused", () => {
    mkdirSync(lockPath)
    expect(codeOf(() => tryTracked(lockPath))).toBe("invalid_argument")
    rmSync(lockPath, { recursive: true })

    const other = join(tempDir, "other")
    writeFileSync(other, "")
    linkSync(other, lockPath)
    expect(codeOf(() => tryTracked(lockPath))).toBe("invalid_argument")
  })

  test("names a generic reason for a held lock", () => {
    expect(READ_LOCK_HELD).toContain("this reading account")
  })
})
