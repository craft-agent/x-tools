import { writeFile } from "node:fs/promises"
import { COOKIES } from "../core/x/cookies.testing"
import { ensureLabelDir } from "../core/x/labels"
import type { LoginIo } from "./login"

/** Fixtures the tests of the account-management commands share. */

export type CommandRun = { code: number; stdout: string; stderr: string }

/** Runs a command over a collecting `LoginIo` whose standard input is empty; `overrides` replace any part of it. */
export async function runCommand(
  command: (argv: string[], io: LoginIo) => Promise<number>,
  argv: string[],
  overrides: Partial<LoginIo> = {},
): Promise<CommandRun> {
  let stdout = ""
  let stderr = ""
  const code = await command(argv, {
    env: {},
    readStdin: async () => "",
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    ...overrides,
  })
  return { code, stdout, stderr }
}

/** Creates the account's directory with a cookie file in it, as a signed-in account has; returns the directory. */
export async function signedInAccount(stateDir: string, label: string): Promise<string> {
  const paths = await ensureLabelDir(stateDir, label)
  await writeFile(paths.cookies, `${COOKIES}\n`, { mode: 0o600 })
  return paths.dir
}
