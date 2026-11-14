import { z } from "zod"
import { ToolError, isToolError, type ErrorCode, type ErrorDetails } from "../errors"
import type { ExecResult } from "../exec"
import { exitFailure, NETWORK_PASS, run } from "../runner"
import { maskCookies } from "./cookies"
import { enginePaths, readEngineState } from "./engine"

/** What twscrape made of the session after an operation that contacted X. */
export type EngineSession = {
  active: boolean
  error: string | null
  /** Queue name → when its lock ends (ISO 8601 with a UTC offset); only locks still in the future. */
  locks: Readonly<Record<string, string>>
}

const FAILURE_KINDS = [
  "invalid_request",
  "setup",
  "refused",
  "no_account",
  "timeout",
  "x_error",
  "parse_error",
  "search_refused",
  "error",
] as const

/** Why the bridge could not answer an operation. */
export type EngineFailureKind = (typeof FAILURE_KINDS)[number]

type Common = {
  /** The first 16 hex characters of SHA-256 of the `auth_token` value, or null when the cookies could not be parsed. */
  fingerprint: string | null
  /** Whether X was, or may have been, contacted. */
  contacted: boolean
  session: EngineSession | null
  warnings: readonly string[]
}

/** The bridge's one JSON reply: `ok` with the operation's `data`, or a failure with its `kind` and a masked `error`. */
export type EngineReply =
  (Common & { ok: true; data: unknown }) | (Common & { ok: false; kind: EngineFailureKind; error: string })

/** What `callEngine` needs. */
export type EngineCallOptions = {
  stateDir: string
  /** `<package root>/engine/bridge.py` */
  bridgeFile: string
  op: string
  args?: Readonly<Record<string, unknown>>
  /** The cookie string; it reaches the bridge on standard input only. */
  cookies: string
  /** The fingerprint of a session X refused earlier, if the caller remembers one. */
  refused?: string | null
  /** The environment the passed-through variables are read from. */
  env: Readonly<Record<string, string | undefined>>
  signal?: AbortSignal
  /** The limit on the child; defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number
  /** The seconds the bridge allows the operation, shorter than `timeoutMs`; defaults to `DEFAULT_DEADLINE_SECONDS`. */
  deadlineSeconds?: number
}

/** How long the child may run before it is stopped. */
const DEFAULT_TIMEOUT_MS = 90_000

/** How many seconds the bridge allows an operation. */
const DEFAULT_DEADLINE_SECONDS = 60

/** The engine's name in messages. */
const ENGINE_NAME = "The engine"

/** Fixed for the bridge: twscrape sends no telemetry, logs only warnings, and Python's streams are UTF-8. */
const ENGINE_SET = {
  TWS_TELEMETRY: "0",
  DO_NOT_TRACK: "1",
  TWS_LOG_LEVEL: "WARNING",
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
} as const

const commonShape = {
  fingerprint: z.string().nullable(),
  contacted: z.boolean(),
  session: z
    .object({ active: z.boolean(), error: z.string().nullable(), locks: z.record(z.string(), z.string()) })
    .nullable(),
  warnings: z.array(z.string()),
}

const replySchema = z.discriminatedUnion("ok", [
  z.object({ ...commonShape, ok: z.literal(true), data: z.unknown() }),
  z.object({ ...commonShape, ok: z.literal(false), kind: z.enum(FAILURE_KINDS), error: z.string() }),
])

function parseReply(stdout: string): EngineReply | undefined {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return undefined
  }
  const parsed = replySchema.safeParse(json)
  return parsed.success ? (parsed.data as EngineReply) : undefined
}

/** A runner error whose message the child's words could reach, with the cookies masked out of it. */
function maskedRunnerError(error: unknown, cookies: string): unknown {
  if (!isToolError(error)) return error
  const message = maskCookies(error.message, cookies)
  if (message === error.message) return error
  return new ToolError(error.code, message, { details: error.details as ErrorDetails | undefined })
}

/** The failure of a child that exited non-zero or wrote no reply; X may have been contacted, so the pacing layer counts it. */
function replyFailure(result: ExecResult, cookies: string): ToolError {
  const masked = { ...result, stdout: maskCookies(result.stdout, cookies), stderr: maskCookies(result.stderr, cookies) }
  const failure = exitFailure(masked, ENGINE_NAME)
  return new ToolError(failure.code, failure.message, { details: { ...failure.details, contacted: true } })
}

/**
 * Runs one operation of the engine: the venv's Python runs the bridge with
 * the request as JSON on standard input, and its one JSON reply comes back,
 * whether it says `ok` or names a failure (`engineOutcome` turns that into a
 * value or a `ToolError`). The cookies go on standard input only, never in the
 * arguments or the environment.
 *
 * An engine that is not `ready` throws `not_found` with
 * `details.action: "engine_install"` and starts nothing. A child that exits
 * non-zero, or whose output is not a reply, throws `upstream_error` with its
 * last line, the cookies masked, and `details.contacted: true`; a child that
 * outlives `timeoutMs`, an abort and a program that cannot be run propagate
 * from the runner, with the cookies masked out of their messages.
 */
export async function callEngine(options: EngineCallOptions): Promise<EngineReply> {
  await requireEngine(options.stateDir)

  const { dir, python } = enginePaths(options.stateDir)
  const request = JSON.stringify({
    op: options.op,
    cookies: options.cookies,
    refused: options.refused ?? null,
    deadline: options.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS,
    args: options.args ?? {},
  })

  let result: ExecResult
  try {
    result = await run([python, "-I", "-B", options.bridgeFile], {
      env: options.env,
      pass: NETWORK_PASS,
      set: ENGINE_SET,
      stdin: request,
      cwd: dir,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: options.signal,
      name: ENGINE_NAME,
    })
  } catch (error) {
    throw maskedRunnerError(error, options.cookies)
  }

  const reply = result.code === 0 ? parseReply(result.stdout.trim()) : undefined
  if (reply) return reply
  throw replyFailure(result, options.cookies)
}

/**
 * Fails with `not_found` and `details.action: "engine_install"` unless the
 * engine under `stateDir` is `ready`; reads files only and starts nothing.
 */
export async function requireEngine(stateDir: string): Promise<void> {
  const state = await readEngineState(stateDir)
  if (state.status !== "ready") {
    throw new ToolError(
      "not_found",
      "The engine is not installed or does not match this release; run engine install.",
      { details: { action: "engine_install", engine_status: state.status } },
    )
  }
}

/** The error text without its final full stop, so a message that ends in it reads once. */
function sentence(text: string): string {
  return text.replace(/\.$/, "")
}

/** The latest lock of the session as a time in milliseconds, or undefined when it has none a clock can read. */
function latestLock(session: EngineSession | null): number | undefined {
  const times = Object.values(session?.locks ?? {})
    .map((lock) => Date.parse(lock))
    .filter((time) => Number.isFinite(time))
  return times.length > 0 ? Math.max(...times) : undefined
}

type EngineFailure = Extract<EngineReply, { ok: false }>

/** The code, message and details a failed reply maps to; `engineOutcome` adds `kind` and `contacted`. */
type Mapped = [code: ErrorCode, message: string, details: ErrorDetails]

function noAccountFailure(reply: EngineFailure, now: number): Mapped {
  const until = latestLock(reply.session)
  if (until !== undefined && until > now) {
    const iso = new Date(until).toISOString()
    return ["rate_limited", `X is rate-limiting the reading account until ${iso}.`, { until: iso }]
  }
  if (reply.session?.active === false) {
    return [
      "unauthenticated",
      `X refused this reading account's session: ${sentence(reply.session.error ?? reply.error)}.`,
      { reason: "refused" },
    ]
  }
  return ["upstream_error", `X had no usable reading account: ${sentence(reply.error)}.`, {}]
}

function failureOf(reply: EngineFailure, now: number): Mapped {
  switch (reply.kind) {
    case "setup":
      return ["unauthenticated", `The reading account's cookies are not usable: ${sentence(reply.error)}.`, {}]
    case "refused":
      return [
        "unauthenticated",
        "X refused this reading account's session; sign in again with fresh cookies.",
        { reason: "refused" },
      ]
    case "no_account":
      return noAccountFailure(reply, now)
    case "timeout":
      return ["upstream_error", "X did not answer in time.", {}]
    case "x_error":
      return ["upstream_error", `X answered with an error: ${sentence(reply.error)}.`, {}]
    case "parse_error":
      return ["upstream_error", `X's answer could not be read: ${sentence(reply.error)}.`, {}]
    case "search_refused":
      return [
        "forbidden",
        "X refused this reading account a search: X refuses search to an account whose phone is not verified.",
        { reason: "search_refused" },
      ]
    case "invalid_request":
      return ["internal_error", `The engine rejected the request: ${sentence(reply.error)}.`, {}]
    case "error":
      return ["upstream_error", `The engine failed: ${sentence(reply.error)}.`, {}]
  }
}

/**
 * The value of an `ok` reply, or the `ToolError` its failure maps to:
 * `setup` and `refused` are `unauthenticated`; `no_account` is `rate_limited`
 * while a session lock lies after `now` (with `details.until`),
 * `unauthenticated` for a session twscrape marked inactive, else
 * `upstream_error`; `search_refused`, a search X refuses to an account whose
 * phone is not verified, is `forbidden` with `details.reason`
 * `search_refused`; `timeout`, `x_error`, `parse_error` and `error` are
 * `upstream_error`; `invalid_request` is `internal_error`. Every failure's
 * details carry the reply's `kind` and `contacted`, and no message holds the
 * cookies, which the bridge masked out of `error`.
 */
export function engineOutcome(reply: EngineReply, now: number = Date.now()): unknown {
  if (reply.ok) return reply.data
  const [code, message, details] = failureOf(reply, now)
  throw new ToolError(code, message, { details: { ...details, kind: reply.kind, contacted: reply.contacted } })
}
