import { cut } from "../describe"
import { isToolError, type ToolError } from "../errors"
import { cookieFingerprint, maskCookies, readCookies, type CookieSource } from "../x/cookies"
import type { LabelPaths } from "../x/labels"
import type { PacingState, Refusal } from "../x/pacing"
import type { CookieStatus } from "./schemas"

/** The most characters of X's own words a result keeps. */
export const MAX_REFUSED_ERROR_LENGTH = 200

/** What a label's cookies are like, read without contacting anything. */
export type CookieReport = {
  source: CookieSource | null
  status: CookieStatus
  /** The fingerprint of the cookies when they are available, else null. */
  fingerprint: string | null
  /** `text` with the cookies' values masked; unchanged when there are no usable cookies. */
  mask(text: string): string
}

const unusable = (source: CookieSource | null, status: CookieStatus): CookieReport => ({
  source,
  status,
  fingerprint: null,
  mask: (text) => text,
})

/**
 * Whether `error` is the one `readCookies` gives for a cookie file that is not
 * there: the only `unauthenticated` one that names the account and variable.
 */
function isMissingFile(error: ToolError): boolean {
  return error.details?.account !== undefined
}

/**
 * Where a label's cookies come from and whether they are usable: the variable
 * when it is set, even when it holds no pair, else the file. A missing file is
 * `missing`; a value without both cookies is `invalid`; a link, wrong mode or
 * any other failure reading the file is `unreadable`. The values are never part
 * of the report, only their fingerprint and a way to mask them.
 */
export async function readCookieReport(options: {
  paths: LabelPaths
  variable: string
  env: Readonly<Record<string, string | undefined>>
}): Promise<CookieReport> {
  try {
    const cookies = await readCookies(options)
    return {
      source: cookies.source,
      status: "available",
      fingerprint: cookieFingerprint(cookies.value),
      mask: (text) => maskCookies(text, cookies.value),
    }
  } catch (error) {
    if (!isToolError(error) || error.code !== "unauthenticated") return unusable("file", "unreadable")
    if (options.env[options.variable] !== undefined) return unusable("variable", "invalid")
    return isMissingFile(error) ? unusable(null, "missing") : unusable("file", "invalid")
  }
}

/** The refusal X's session verdict remembers, when it is the one of the current cookies. */
export function currentRefusal(pacing: PacingState, fingerprint: string | null): Refusal | null {
  return fingerprint !== null && pacing.refused?.fingerprint === fingerprint ? pacing.refused : null
}

/** A stored time as ISO 8601, or null when it is not a date. */
export function isoOrNull(text: string): string | null {
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/** When X's rate limit ends, in epoch milliseconds, while that lies after `now`; else null. */
export function rateLimitEnd(pacing: PacingState, now: number): number | null {
  const end = pacing.rate_limited_until === null ? NaN : Date.parse(pacing.rate_limited_until)
  return end > now ? end : null
}

/** X's own words from a refusal, with the cookies' values masked and clipped to `MAX_REFUSED_ERROR_LENGTH` characters. */
export function refusedError(refusal: Refusal, cookies: CookieReport): string | null {
  return refusal.error === null ? null : cut(cookies.mask(refusal.error), MAX_REFUSED_ERROR_LENGTH)
}
