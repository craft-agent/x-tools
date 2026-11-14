import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "./errors"
import { run } from "./runner"

const PATH = process.env.PATH ?? ""
/** The running runtime itself, since a `node` found on PATH may be a shim that adds variables of its own. */
const NODE = process.execPath
const PRINT_ENV = "process.stdout.write(JSON.stringify(process.env))"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runner-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function childEnv(options: Partial<Parameters<typeof run>[1]>): Promise<Record<string, string>> {
  const result = await run([NODE, "-e", PRINT_ENV], { env: {}, timeoutMs: 10_000, ...options })
  return JSON.parse(result.stdout) as Record<string, string>
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

describe("run environment", () => {
  test("is exactly the base variables, the passed names and the fixed values", async () => {
    const env = await childEnv({
      env: {
        PATH,
        HOME: "/home/x",
        TMPDIR: "/tmp/x",
        LANG: "C",
        LC_ALL: "",
        LC_CTYPE: undefined,
        STRAY: "leaks",
        PASSED: "yes",
      },
      pass: ["PASSED", "NOT_SET"],
    })
    expect(env).toEqual({
      PATH,
      HOME: "/home/x",
      TMPDIR: "/tmp/x",
      LANG: "C",
      PASSED: "yes",
      NO_COLOR: "1",
      TERM: "dumb",
    })
  })

  test("does not read from this process's own environment", async () => {
    process.env.RUNNER_TEST_STRAY = "leaked"
    try {
      const env = await childEnv({ env: { PATH }, pass: [] })
      expect(Object.keys(env).sort()).toEqual(["NO_COLOR", "PATH", "TERM"])
    } finally {
      delete process.env.RUNNER_TEST_STRAY
    }
  })

  test("fixed values win over passed ones and the defaults", async () => {
    const env = await childEnv({
      env: { PATH, PASSED: "from env", TERM: "xterm", NO_COLOR: "0" },
      pass: ["PASSED", "TERM", "NO_COLOR"],
      set: { PASSED: "fixed", TERM: "vt100", EXTRA: "1" },
    })
    expect(env.PASSED).toBe("fixed")
    expect(env.TERM).toBe("vt100")
    expect(env.NO_COLOR).toBe("1")
    expect(env.EXTRA).toBe("1")
  })

  test("passes cwd and stdin", async () => {
    const result = await run(
      [NODE, "-e", "process.stdout.write(process.cwd() + ':');process.stdin.pipe(process.stdout)"],
      {
        env: { PATH },
        cwd: dir,
        stdin: "in",
        timeoutMs: 10_000,
      },
    )
    expect(result.stdout.endsWith(":in")).toBe(true)
  })
})

describe("run exits", () => {
  test("returns a non-zero exit instead of throwing", async () => {
    const result = await run([NODE, "-e", 'process.stderr.write("bad");process.exit(3)'], {
      env: { PATH },
      timeoutMs: 10_000,
    })
    expect(result).toEqual({ code: 3, stdout: "", stderr: "bad" })
  })
})

describe("run failures", () => {
  test("a program that is not found is not_found, named by its basename", async () => {
    const error = await failure(run(["/nowhere/definitely-not-a-program"], { env: { PATH }, timeoutMs: 10_000 }))
    expect(isToolError(error) && error.code).toBe("not_found")
    expect((error as Error).message).toBe("definitely-not-a-program was not found; is it installed and on PATH?")
    expect(isToolError(error) && error.details).toEqual({ program: "definitely-not-a-program" })
  })

  test("`name` replaces the basename in messages", async () => {
    const error = await failure(run(["definitely-not-a-program"], { env: { PATH }, timeoutMs: 10_000, name: "tool" }))
    expect((error as Error).message).toBe("tool was not found; is it installed and on PATH?")
  })

  test("a program is looked up on the PATH given, and only there", async () => {
    const file = join(dir, "fakeprog")
    writeFileSync(file, "#!/bin/sh\necho fake\n")
    chmodSync(file, 0o755)
    const found = await run(["fakeprog"], { env: { PATH: dir }, timeoutMs: 10_000 })
    expect(found.stdout).toBe("fake\n")
    const error = await failure(run(["fakeprog"], { env: { PATH }, timeoutMs: 10_000 }))
    expect(isToolError(error) && error.code).toBe("not_found")
  })

  test("a program that is not executable is forbidden", async () => {
    const file = join(dir, "plain")
    writeFileSync(file, "#!/bin/sh\n")
    chmodSync(file, 0o644)
    const error = await failure(run([file], { env: { PATH }, timeoutMs: 10_000 }))
    expect(isToolError(error) && error.code).toBe("forbidden")
    expect((error as Error).message).toBe("plain could not be run: permission denied.")
  })

  test("another spawn error is internal_error with its message", async () => {
    const file = join(dir, "file")
    writeFileSync(file, "")
    const error = await failure(run([NODE, "-e", "1"], { env: { PATH }, cwd: file, timeoutMs: 10_000, name: "prog" }))
    expect(isToolError(error) && error.code).toBe("internal_error")
    expect((error as Error).message).toStartWith("prog could not be run: ")
  })
})
