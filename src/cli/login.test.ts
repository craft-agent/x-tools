import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { AUTH, COOKIES, CT0 } from "../core/x/cookies.testing"
import { cookieVariable } from "../core/x/cookies"
import { labelPaths } from "../core/x/labels"
import { removeTempDirs, tempDir } from "../core/x/engine.testing"
import { PROJECT } from "../project"
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from "./command-io"
import { runCommand, signedInAccount, type CommandRun } from "./commands.testing"
import { runLoginCommand } from "./login"

afterEach(removeTempDirs)

const STATE_DIR_FLAG = "--state-dir"
const DEFAULT_VARIABLE = cookieVariable(PROJECT.envPrefix, "default")
const MUST_NOT_READ = async (): Promise<string> => {
  throw new Error("must not read standard input")
}

function login(argv: string[], overrides: Parameters<typeof runCommand>[2] = {}): Promise<CommandRun> {
  return runCommand(runLoginCommand, argv, overrides)
}

function leaks(run: CommandRun): boolean {
  return [AUTH, CT0].some((value) => (run.stdout + run.stderr).includes(value))
}

describe("login from standard input", () => {
  test("writes the cookies and a newline to the default label's file, mode 600", async () => {
    const stateDir = await tempDir()

    const run = await login([STATE_DIR_FLAG, stateDir], { readStdin: async () => `  ${COOKIES}\n` })

    const { cookies } = labelPaths(stateDir, "default")
    expect(run.code).toBe(EXIT_OK)
    expect(await readFile(cookies, "utf8")).toBe(`${COOKIES}\n`)
    expect((await stat(cookies)).mode & 0o777).toBe(0o600)
    expect(run.stdout).toBe(
      `Signed in "default": the cookies are in ${cookies} (mode 600). Nothing was sent to X; the first read checks them.\n`,
    )
    expect(run.stderr).toBe("")
    expect(leaks(run)).toBe(false)
  })

  test("replaces an existing cookie file", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "default")
    const replacement = "auth_token=newauthvalue1; ct0=newct0value2"

    const run = await login([STATE_DIR_FLAG, stateDir], { readStdin: async () => replacement })

    expect(run.code).toBe(EXIT_OK)
    expect(await readFile(labelPaths(stateDir, "default").cookies, "utf8")).toBe(`${replacement}\n`)
  })

  test("--account names the label, in either form of the flag", async () => {
    const stateDir = await tempDir()

    const spaced = await login(["--account", "work", STATE_DIR_FLAG, stateDir], { readStdin: async () => COOKIES })
    const equals = await login([`--account=other`, `${STATE_DIR_FLAG}=${stateDir}`], { readStdin: async () => COOKIES })

    expect(spaced.code).toBe(EXIT_OK)
    expect(spaced.stdout).toContain('Signed in "work"')
    expect(equals.code).toBe(EXIT_OK)
    expect(await readdir(join(stateDir, "accounts"))).toEqual(["other", "work"])
  })

  test("cookies pasted into --account are refused without being repeated", async () => {
    const stateDir = await tempDir()

    const run = await login(["--account", COOKIES, STATE_DIR_FLAG, stateDir], { readStdin: MUST_NOT_READ })

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stderr).toContain("Invalid label:")
    expect(leaks(run)).toBe(false)
  })

  test("--state-dir decides where the account is kept, ahead of the environment", async () => {
    const stateDir = await tempDir()
    const fromEnvironment = await tempDir()

    const run = await login([STATE_DIR_FLAG, stateDir], {
      env: { X_TOOLS_STATE_DIR: fromEnvironment },
      readStdin: async () => COOKIES,
    })

    expect(run.code).toBe(EXIT_OK)
    expect(await readdir(join(stateDir, "accounts"))).toEqual(["default"])
    expect(await readdir(fromEnvironment)).toEqual([])
  })

  test.each([
    ["empty", ""],
    ["blank", "  \n"],
    ["without ct0", `auth_token=${AUTH}`],
    ["without auth_token", `ct0=${CT0}`],
    ["with an empty ct0", `auth_token=${AUTH}; ct0=`],
  ])("input that is %s is refused, never echoed, and stores nothing", async (_name, input) => {
    const stateDir = await tempDir()

    const run = await login([STATE_DIR_FLAG, stateDir], { readStdin: async () => input })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe("")
    expect(run.stderr).toBe(
      "x-tools-cli: The cookies need both auth_token and ct0, as a browser holds them for x.com.\n",
    )
    expect(leaks(run)).toBe(false)
    expect(await readdir(stateDir)).toEqual([])
  })

  test("a failure after the input was read has the cookies masked out of its message", async () => {
    const stateDir = join(await tempDir(), COOKIES)
    await mkdir(stateDir)
    await writeFile(join(stateDir, "accounts"), "in the way")

    const run = await login([STATE_DIR_FLAG, stateDir], { readStdin: async () => COOKIES })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain("[masked]")
    expect(leaks(run)).toBe(false)
  })

  test("cancelling the input says so and stores nothing", async () => {
    const stateDir = await tempDir()
    const controller = new AbortController()
    const readStdin = async (): Promise<string> => {
      controller.abort()
      controller.signal.throwIfAborted()
      return COOKIES
    }

    const run = await login([STATE_DIR_FLAG, stateDir], { readStdin, signal: controller.signal })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toBe("x-tools-cli: Cancelled.\n")
    expect(await readdir(stateDir)).toEqual([])
  })
})

describe("login with the variable set", () => {
  test("uses the variable, stores nothing and never reads standard input", async () => {
    const stateDir = await tempDir()

    const run = await login([STATE_DIR_FLAG, stateDir], {
      env: { [DEFAULT_VARIABLE]: ` ${COOKIES} ` },
      readStdin: MUST_NOT_READ,
    })

    const paths = labelPaths(stateDir, "default")
    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toBe(`Reading account "default" uses the cookies in ${DEFAULT_VARIABLE}; nothing was stored.\n`)
    expect(await readdir(paths.dir)).toEqual([])
    expect(leaks(run)).toBe(false)
  })

  test("the label picks the variable", async () => {
    const stateDir = await tempDir()

    const run = await login(["--account", "my_acct1", STATE_DIR_FLAG, stateDir], {
      env: { [cookieVariable(PROJECT.envPrefix, "my_acct1")]: COOKIES },
      readStdin: MUST_NOT_READ,
    })

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toContain("X_TOOLS_COOKIES_MY_ACCT1")
    expect(await readdir(join(stateDir, "accounts"))).toEqual(["my_acct1"])
  })

  test("an existing cookie file is left alone and said to be ignored", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "default")
    const { cookies } = labelPaths(stateDir, "default")

    const run = await login([STATE_DIR_FLAG, stateDir], {
      env: { [DEFAULT_VARIABLE]: COOKIES },
      readStdin: MUST_NOT_READ,
    })

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout.split("\n")).toEqual([
      `Reading account "default" uses the cookies in ${DEFAULT_VARIABLE}; nothing was stored.`,
      `The cookie file ${cookies} is ignored while ${DEFAULT_VARIABLE} is set.`,
      "",
    ])
    expect(await readFile(cookies, "utf8")).toBe(`${COOKIES}\n`)
  })

  test.each([
    ["empty", ""],
    ["blank", "   "],
    ["without ct0", `auth_token=${AUTH}`],
  ])("a variable that is %s fails without reading standard input or creating the account", async (_name, value) => {
    const stateDir = await tempDir()

    const run = await login([STATE_DIR_FLAG, stateDir], {
      env: { [DEFAULT_VARIABLE]: value },
      readStdin: MUST_NOT_READ,
    })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe("")
    expect(run.stderr).toBe(`x-tools-cli: \`${DEFAULT_VARIABLE}\` does not hold both auth_token and ct0.\n`)
    expect(leaks(run)).toBe(false)
    expect(await readdir(stateDir)).toEqual([])
  })
})

describe("login arguments", () => {
  test.each([
    ["an unknown flag", ["--unknown"]],
    ["a cookie string", [COOKIES]],
    ["a cookie flag", ["--cookies", COOKIES]],
    ["a cookie flag with a value", [`--cookies=${COOKIES}`]],
    ["a stray word", ["work"]],
    ["an account without a value", ["--account"]],
    ["an invalid label", ["--account", "Work"]],
    ["a state directory without a value", [STATE_DIR_FLAG]],
  ])("%s is a usage error that reads and stores nothing", async (_name, argv) => {
    const stateDir = await tempDir()

    const run = await login([...argv, `${STATE_DIR_FLAG}=${stateDir}`], { readStdin: MUST_NOT_READ })

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stdout).toBe("")
    expect(leaks(run)).toBe(false)
    expect(await readdir(stateDir)).toEqual([])
  })
})
