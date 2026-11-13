import type { EngineState } from "../x/engine"
import { DAY_MS, HOUR_MS, within, type PaceSettings, type PacingState } from "../x/pacing"
import type { AccountRow, CookieStatus } from "./schemas"

/** What decides an account's health, all of it read from files. */
export type HealthInput = {
  label: string
  engine: EngineState["status"]
  cookies: CookieStatus
  /** Whether X refused the session the current cookies make. */
  refused: boolean
  /** When X's running rate limit ends, in epoch milliseconds, or null when none runs. */
  rateLimitedUntil: number | null
  pacing: PacingState
  settings: PaceSettings
  now: number
  cli: string
  stateDir: string
}

/** The sentence that says what a person does, for the actions that need one; `wait` says until when, so it is made where the time is known. */
const HINTS = {
  engine_install: "The engine is not installed as this release needs it; a person installs it before any read.",
  login:
    "The reading account's cookies are missing, unusable or refused by X; a person signs in again with fresh ones.",
} as const

/** POSIX shell quoting keeps the command's words, such as a path with a space, single arguments. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** The command a person runs to install the engine. */
export function engineInstallCommand(cli: string, stateDir: string): string {
  return [quote(cli), "engine", "install", "--state-dir", quote(stateDir)].join(" ")
}

function loginCommand(cli: string, label: string, stateDir: string): string {
  return [quote(cli), "login", "--account", quote(label), "--state-dir", quote(stateDir)].join(" ")
}

/** When the reads in the window leave it far enough for one more, or null while the cap is not reached. */
function capEnd(pacing: PacingState, now: number, windowMs: number, cap: number): number | null {
  const reads = within(pacing, now, windowMs)
  return reads.length >= cap ? reads.reduce((oldest, time) => Math.min(oldest, time)) + windowMs : null
}

/**
 * Derives what an account needs: the reasons, one next action and its hint
 * and command. An engine that is not ready outranks cookies and a refusal,
 * which outrank waiting for X's rate limit or a cap.
 */
export function assessHealth(
  input: HealthInput,
): Pick<AccountRow, "health" | "reasons" | "action" | "hint" | "recovery_command"> {
  const { engine, cookies, pacing, settings, now } = input
  const hourEnd = capEnd(pacing, now, HOUR_MS, settings.perHour)
  const dayEnd = capEnd(pacing, now, DAY_MS, settings.perDay)

  const reasons: string[] = []
  if (engine !== "ready") reasons.push(`engine_${engine}`)
  if (cookies !== "available") reasons.push(`cookies_${cookies}`)
  if (input.refused) reasons.push("refused")
  if (input.rateLimitedUntil !== null) reasons.push("rate_limited")
  if (hourEnd !== null) reasons.push("hourly_cap")
  if (dayEnd !== null) reasons.push("daily_cap")

  const waits = [input.rateLimitedUntil, hourEnd, dayEnd].filter((time) => time !== null)
  const needsLogin = cookies !== "available" || input.refused
  const health: AccountRow["health"] = reasons.length === 0 ? "ready" : "attention"
  const none = { health, reasons, action: null, hint: null, recovery_command: null }

  if (engine !== "ready") {
    return {
      ...none,
      action: "engine_install",
      hint: HINTS.engine_install,
      recovery_command: engineInstallCommand(input.cli, input.stateDir),
    }
  }
  if (needsLogin) {
    return {
      ...none,
      action: "login",
      hint: HINTS.login,
      recovery_command: loginCommand(input.cli, input.label, input.stateDir),
    }
  }
  if (waits.length > 0) {
    const until = new Date(Math.max(...waits)).toISOString()
    return {
      ...none,
      action: "wait",
      hint: `X's rate limit or a read cap holds this reading account back until ${until}.`,
    }
  }
  return none
}
