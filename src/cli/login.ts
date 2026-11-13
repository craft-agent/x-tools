import { lstat } from "node:fs/promises"
import { ToolError } from "../core"
import { cookieVariable, hasCookiePair, maskCookies } from "../core/x/cookies"
import { DEFAULT_LABEL, ensureLabelDir } from "../core/x/labels"
import { isMissingPath } from "../core/x/missing-path"
import { writePrivateFile } from "../core/x/private-file"
import { PROJECT_PROFILE } from "../entry/profile"
import {
  ACCOUNT_FLAG,
  STATE_DIR_FLAG,
  commandLabel,
  handleCommandError,
  parseFlagArgs,
  resolveCommandStateDir,
  usageError,
} from "./command-args"
import { EXIT_OK, throwIfCancelled, type CommandIo } from "./command-io"

const USAGE = `Login accepts only ${ACCOUNT_FLAG} and ${STATE_DIR_FLAG}; the cookies are read from standard input, never from an argument.`
const COOKIES_NEEDED = "The cookies need both auth_token and ct0, as a browser holds them for x.com."

/** What `login` needs: the command's surroundings and a way to read the cookies from standard input. */
export type LoginIo = CommandIo & { readStdin(): Promise<string> }

/** Reads the command line; its arguments are never echoed, since one may have been a cookie string. */
function parseLoginCommand(argv: string[], io: CommandIo): { stateDir: string; label: string } {
  const { values, rest } = parseFlagArgs(argv, { values: [ACCOUNT_FLAG, STATE_DIR_FLAG] })
  if (rest.length > 0) throw usageError(USAGE)
  const stateDir = resolveCommandStateDir(values[STATE_DIR_FLAG], io)
  return { stateDir, label: commandLabel(values[ACCOUNT_FLAG] ?? DEFAULT_LABEL) }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissingPath(error)) return false
    throw error
  }
}

/**
 * The error with the cookies masked out of its message, in case any path
 * carried them. Input that does not hold the pair is refused with a fixed
 * message before any path sees it, and masking a stray fragment would only
 * garble that message.
 */
function maskedError(error: unknown, cookies: string): unknown {
  if (!(error instanceof ToolError) || !hasCookiePair(cookies)) return error
  const message = maskCookies(error.message, cookies)
  return message === error.message ? error : new ToolError(error.code, message)
}

/**
 * The `login` command: gives a reading account its cookies. When the
 * account's `<envPrefix>_COOKIES_<LABEL>` variable is set (even empty) the
 * cookies are that variable's, nothing is stored and standard input is not
 * read. Otherwise the cookies are read from standard input (on a terminal as a
 * hidden prompt, piped to its end) and stored in the account's cookie file
 * with mode 600. They are never an argument, and never in a message. Nothing
 * is sent to X; the first read checks them. Takes `--account <label>`
 * (default `default`) and `--state-dir <path>`. Resolves to the exit code: 0,
 * 1 after a failure, 2 for a mistake in the command line.
 */
export async function runLoginCommand(argv: string[], io: LoginIo): Promise<number> {
  let command: { stateDir: string; label: string }
  try {
    command = parseLoginCommand(argv, io)
  } catch (error) {
    return handleCommandError(error, io, { mode: "usage" })
  }
  const { stateDir, label } = command
  const variable = cookieVariable((io.profile ?? PROJECT_PROFILE).envPrefix, label)

  let cookies = ""
  try {
    throwIfCancelled(io.signal)
    const fromVariable = io.env[variable]
    if (fromVariable !== undefined) {
      cookies = fromVariable.trim()
      if (!hasCookiePair(cookies)) {
        throw new ToolError("unauthenticated", `\`${variable}\` does not hold both auth_token and ct0.`)
      }
      const paths = await ensureLabelDir(stateDir, label)
      const lines = [`Reading account "${label}" uses the cookies in ${variable}; nothing was stored.`]
      if (await pathExists(paths.cookies)) {
        lines.push(`The cookie file ${paths.cookies} is ignored while ${variable} is set.`)
      }
      io.stdout(`${lines.join("\n")}\n`)
      return EXIT_OK
    }

    cookies = (await io.readStdin()).trim()
    if (!hasCookiePair(cookies)) throw new ToolError("invalid_argument", COOKIES_NEEDED)
    throwIfCancelled(io.signal)
    const paths = await ensureLabelDir(stateDir, label)
    await writePrivateFile(paths.cookies, `${cookies}\n`)
    io.stdout(
      `Signed in "${label}": the cookies are in ${paths.cookies} (mode 600). Nothing was sent to X; the first read checks them.\n`,
    )
    return EXIT_OK
  } catch (error) {
    return handleCommandError(maskedError(error, cookies), io, { abortMessage: "Cancelled." })
  }
}
