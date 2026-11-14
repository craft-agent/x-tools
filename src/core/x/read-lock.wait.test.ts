import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "../errors"
import { READ_LOCK_HELD, tryReadLock, waitForReadLock } from "./read-lock"

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

function hold(): () => void {
  const release = tryReadLock(lockPath)
  if (!release) throw new Error("expected the lock to be free")
  releases.push(release)
  return release
}

describe("waitForReadLock", () => {
  test("takes a free lock at once", async () => {
    const release = await waitForReadLock(lockPath, { waitMs: 0 })
    releases.push(release)
    expect(tryReadLock(lockPath)).toBeUndefined()
  })

  test("waits while the lock is held and takes it once released", async () => {
    const holder = hold()
    setTimeout(holder, 60)
    const release = await waitForReadLock(lockPath, {
      waitMs: 5_000,
      pollMs: 10,
    })
    releases.push(release)
    expect(tryReadLock(lockPath)).toBeUndefined()
  })

  test("gives up past waitMs with rate_limited and the read_lock reason", async () => {
    hold()
    let clock = 1_000
    const slept: number[] = []
    const error = await waitForReadLock(lockPath, {
      waitMs: 500,
      pollMs: 200,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms)
        clock += ms
      },
    }).catch((caught: unknown) => caught)

    expect(isToolError(error)).toBe(true)
    if (!isToolError(error)) return
    expect(error.code).toBe("rate_limited")
    expect(error.message).toBe(READ_LOCK_HELD)
    expect(error.details).toEqual({ reason: "read_lock" })
    expect(slept).toEqual([200, 200, 100])
  })

  test("a given message and details word the refusal, the reason staying read_lock", async () => {
    hold()
    const error = await waitForReadLock(lockPath, {
      waitMs: 0,
      heldMessage: "Busy.",
      heldDetails: { source: "elsewhere", reason: "other" },
    }).catch((caught: unknown) => caught)

    expect(isToolError(error) && error.message).toBe("Busy.")
    expect(isToolError(error) && error.details).toEqual({ source: "elsewhere", reason: "read_lock" })
  })

  test("an abort while waiting rejects with the AbortError and holds nothing", async () => {
    const holder = hold()
    const controller = new AbortController()
    const waiting = waitForReadLock(lockPath, {
      waitMs: 5_000,
      pollMs: 10,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 30)
    const error = await waiting.catch((caught: unknown) => caught)

    expect((error as Error).name).toBe("AbortError")
    holder()
    const release = tryReadLock(lockPath)
    expect(release).toBeDefined()
    release?.()
  })

  test("an already aborted signal rejects before the lock is tried", async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await waitForReadLock(lockPath, {
      waitMs: 5_000,
      signal: controller.signal,
    }).catch((caught: unknown) => caught)

    expect((error as Error).name).toBe("AbortError")
    const release = tryReadLock(lockPath)
    expect(release).toBeDefined()
    release?.()
  })
})
