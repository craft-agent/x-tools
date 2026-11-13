import { lstat, readFile } from "node:fs/promises"
import type { Stats } from "node:fs"
import { ToolError } from "../errors"
import type { LabelPaths } from "./labels"
import { isMissingPath } from "./missing-path"

/** Where a label's cookies come from: the environment variable, or the label's cookie file. */
export type CookieSource = "variable" | "file"

/** A label's cookies as a browser holds them for x.com, and where they were read from. */
export type Cookies = { source: CookieSource; value: string }

/** Permission bits of group and others; a cookie file may have none of them. */
const GROUP_OTHER_BITS = 0o077

/** The cookies the session needs: `auth_token` is the session, `ct0` its CSRF token. */
const SESSION_COOKIES = ["auth_token", "ct0"] as const

/** What every cookie value found in a text is replaced with. */
const MASK = "[masked]"

/** The name of the variable that holds a label's cookies. */
export function cookieVariable(envPrefix: string, label: string): string {
  return `${envPrefix}_COOKIES_${label.toUpperCase()}`
}

/** `name → value` of a `;`-separated cookie string; names and values are trimmed, a value's surrounding double quotes dropped, and a later pair wins. */
function parseCookiePairs(value: string): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const part of value.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    const cookie = part
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1")
    if (name !== "") pairs.set(name, cookie)
  }
  return pairs
}

/** Whether `value` holds `auth_token` and `ct0`, each with a value that is not empty. */
export function hasCookiePair(value: string): boolean {
  const pairs = parseCookiePairs(value)
  return SESSION_COOKIES.every((name) => (pairs.get(name) ?? "") !== "")
}

/**
 * Replaces the whole cookie string, then the `auth_token` and `ct0` values in
 * it, with `[masked]` wherever `text` holds them, longest first so a value
 * inside a longer one cannot leave a remainder. A value is masked however
 * short it is.
 */
export function maskCookies(text: string, cookies: string): string {
  const pairs = parseCookiePairs(cookies)
  const secrets = [cookies, cookies.trim(), ...SESSION_COOKIES.map((name) => pairs.get(name) ?? "")]
  const longestFirst = [...new Set(secrets.filter((secret) => secret !== ""))].sort((a, b) => b.length - a.length)
  return longestFirst.reduce((masked, secret) => masked.split(secret).join(MASK), text)
}

async function statCookieFile(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isMissingPath(error)) return undefined
    throw error
  }
}

function requirePair(value: string, what: string): string {
  if (!hasCookiePair(value)) {
    throw new ToolError("unauthenticated", `${what} does not hold both auth_token and ct0.`)
  }
  return value
}

/**
 * The label's cookies: the variable when it is set, even empty, and the file
 * is then not read; else the cookie file.
 *
 * The file must be a regular file, not a link, that only its owner can reach.
 * Cookies that are missing or lack `auth_token` or `ct0` throw
 * `unauthenticated`; a bad file throws `forbidden`. No message contains the
 * cookies.
 */
export async function readCookies(options: {
  paths: LabelPaths
  variable: string
  env: Readonly<Record<string, string | undefined>>
}): Promise<Cookies> {
  const { paths, variable, env } = options
  const fromVariable = env[variable]
  if (fromVariable !== undefined)
    return { source: "variable", value: requirePair(fromVariable.trim(), `\`${variable}\``) }

  const stat = await statCookieFile(paths.cookies)
  if (!stat) {
    throw new ToolError(
      "unauthenticated",
      `No cookies for reading account "${paths.label}": set ${variable} or sign in with login.`,
      { details: { account: paths.label, variable } },
    )
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ToolError("forbidden", `The cookie file ${paths.cookies} is a link or not a regular file; replace it.`)
  }
  if (stat.mode & GROUP_OTHER_BITS) {
    throw new ToolError(
      "forbidden",
      `The cookie file ${paths.cookies} is readable by other users; run chmod 600 ${JSON.stringify(paths.cookies)}.`,
    )
  }
  const value = (await readFile(paths.cookies, "utf8")).trim()
  return { source: "file", value: requirePair(value, `The cookie file ${paths.cookies}`) }
}
