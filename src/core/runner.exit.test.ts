import { describe, expect, test } from "bun:test"
import type { ExecResult } from "./exec"
import { exitFailure } from "./runner"

function result(overrides: Partial<ExecResult>): ExecResult {
  return { code: 1, stdout: "", stderr: "", ...overrides }
}

describe("exitFailure", () => {
  test("is an upstream_error naming the program and the exit code", () => {
    const error = exitFailure(result({ code: 2, stderr: "boom\n" }), "tool")
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("tool failed (exit 2): boom")
    expect(error.details).toEqual({ program: "tool", exit_code: 2 })
  })

  test("uses the last non-empty line of stderr", () => {
    const error = exitFailure(result({ stderr: "first\nsecond  \n\n  \n" }), "tool")
    expect(error.message).toBe("tool failed (exit 1): second")
  })

  test("falls back to the last non-empty line of stdout when stderr is blank", () => {
    const error = exitFailure(result({ stdout: "one\ntwo\n", stderr: " \n" }), "tool")
    expect(error.message).toBe("tool failed (exit 1): two")
  })

  test("says nothing more when the program printed nothing", () => {
    expect(exitFailure(result({ code: 7 }), "tool").message).toBe("tool failed (exit 7).")
  })

  test("clips a long line to 300 characters", () => {
    const error = exitFailure(result({ stderr: "x".repeat(500) }), "tool")
    expect(error.message).toBe(`tool failed (exit 1): ${"x".repeat(299)}…`)
  })

  test("reports a program ended by a signal as stopped by it", () => {
    const error = exitFailure(result({ code: -1, signal: "SIGKILL", stderr: "Killed" }), "tool")
    expect(error.message).toBe("tool was stopped by SIGKILL: Killed")
    expect(error.details).toEqual({ program: "tool", exit_code: -1 })
    expect(exitFailure(result({ code: -1, signal: "SIGTERM" }), "tool").message).toBe("tool was stopped by SIGTERM.")
  })
})
