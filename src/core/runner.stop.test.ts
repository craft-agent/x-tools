import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isAbortError, isToolError } from "./errors"
import { run } from "./runner"

const PATH = process.env.PATH ?? ""

let dir: string
let pidFile: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runner-stop-"))
  pidFile = join(dir, "pid")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A program that records its pid and then waits for a long time. */
function sleeper(): string[] {
  const script = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 30000)`
  return [process.execPath, "-e", script]
}

async function recordedPid(): Promise<number> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (existsSync(pidFile) && readFileSync(pidFile, "utf8")) return Number(readFileSync(pidFile, "utf8"))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("the program never recorded its pid")
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

describe("run time limit", () => {
  test("a program past the limit is upstream_error and its child is gone", async () => {
    const error = await failure(run(sleeper(), { env: { PATH }, timeoutMs: 1500, name: "sleeper" }))
    expect(isToolError(error) && error.code).toBe("upstream_error")
    expect((error as Error).message).toBe("sleeper did not finish within 2 s.")
    expect(isToolError(error) && error.details).toEqual({ program: "sleeper", timeout_seconds: 2 })
    expect(isAlive(await recordedPid())).toBe(false)
  })

  test("a program inside the limit is not reported as timed out", async () => {
    const result = await run([process.execPath, "-e", "1"], { env: { PATH }, timeoutMs: 10_000 })
    expect(result.code).toBe(0)
    expect(result.timedOut).toBeUndefined()
  })
})

describe("run abort", () => {
  test("rethrows the AbortError as it is and kills the child", async () => {
    const controller = new AbortController()
    const pending = failure(run(sleeper(), { env: { PATH }, timeoutMs: 30_000, signal: controller.signal }))
    const pid = await recordedPid()
    controller.abort()
    const error = await pending
    expect(isToolError(error)).toBe(false)
    expect(isAbortError(error)).toBe(true)
    const deadline = Date.now() + 5000
    while (isAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
    expect(isAlive(pid)).toBe(false)
  })

  test("an already aborted signal throws the AbortError without running", async () => {
    const error = await failure(run(sleeper(), { env: { PATH }, timeoutMs: 30_000, signal: AbortSignal.abort() }))
    expect(isAbortError(error)).toBe(true)
    expect(existsSync(pidFile)).toBe(false)
  })
})
