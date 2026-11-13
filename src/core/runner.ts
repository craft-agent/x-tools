import { basename } from "node:path"
import { cut } from "./describe"
import { ToolError } from "./errors"
import { exec, type ExecResult } from "./exec"

/** The variables every program gets when they are set and not empty: enough to find itself and its files. */
const BASE_PASS = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"] as const
/** Always set, so no program waits on a person and its output parses the same everywhere. */
const FIXED_ENV = { NO_COLOR: "1", TERM: "dumb" } as const
/** The code point budget of the program's own words in a failure message, including an ellipsis when cut. */
const MAX_FAILURE_TEXT = 300

export type RunOptions = {
  /** The environment the passed-through variables are read from (never merged whole). */
  env: Readonly<Record<string, string | undefined>>
  /** Further variable names passed through when set, beyond the base set. */
  pass?: readonly string[]
  /** Fixed values; they win over anything passed through. */
  set?: Readonly<Record<string, string>>
  /** Text written to the program's stdin; without it stdin is not connected. */
  stdin?: string
  cwd?: string
  /** Required: every call has a time limit. */
  timeoutMs: number
  signal?: AbortSignal
  /** The program's name in messages; defaults to the basename of `argv[0]`. */
  name?: string
}

function childEnv(options: RunOptions): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of [...BASE_PASS, ...(options.pass ?? [])]) {
    const value = options.env[name]
    if (value) env[name] = value
  }
  return { ...env, ...FIXED_ENV, ...options.set }
}

function spawnFailure(error: unknown, name: string): unknown {
  if (!(error instanceof Error) || error.name === "AbortError") return error
  switch ((error as NodeJS.ErrnoException).code) {
    case "ENOENT":
      return new ToolError("not_found", `${name} was not found; is it installed and on PATH?`, {
        cause: error,
        details: { program: name },
      })
    case "EACCES":
      return new ToolError("forbidden", `${name} could not be run: permission denied.`, {
        cause: error,
        details: { program: name },
      })
    default:
      return new ToolError("internal_error", `${name} could not be run: ${error.message}`, { cause: error })
  }
}

/**
 * Runs a program through `exec` with an explicit environment: the base
 * variables and the `pass` names read from `options.env` when set, `NO_COLOR`
 * and `TERM` switched to a plain terminal, then `set` over all of it.
 *
 * A program that is not found, cannot be run, or outlives `timeoutMs` throws
 * a `ToolError`; an abort rethrows its `AbortError`. A non-zero exit is
 * returned, since what it means is the caller's to decide (see `exitFailure`).
 */
export async function run(argv: readonly string[], options: RunOptions): Promise<ExecResult> {
  const name = options.name ?? basename(argv[0] ?? "")
  let result: ExecResult
  try {
    result = await exec([...argv], {
      cwd: options.cwd,
      env: childEnv(options),
      stdin: options.stdin,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    })
  } catch (error) {
    throw spawnFailure(error, name)
  }
  if (result.timedOut) {
    const seconds = Math.ceil(options.timeoutMs / 1000)
    throw new ToolError("upstream_error", `${name} did not finish within ${seconds} s.`, {
      details: { program: name, timeout_seconds: seconds },
    })
  }
  return result
}

function lastLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
  return lines[lines.length - 1]
}

/**
 * The `upstream_error` for a program that exited non-zero: its last non-empty
 * line of stderr, else of stdout, clipped. A program ended by a signal is
 * reported as stopped by it.
 */
export function exitFailure(result: ExecResult, name: string): ToolError {
  const line = lastLine(result.stderr) ?? lastLine(result.stdout)
  const text = line === undefined ? "." : `: ${cut(line, MAX_FAILURE_TEXT)}`
  const message = result.signal
    ? `${name} was stopped by ${result.signal}${text}`
    : `${name} failed (exit ${result.code})${text}`
  return new ToolError("upstream_error", message, {
    details: { program: name, exit_code: result.code },
  })
}
