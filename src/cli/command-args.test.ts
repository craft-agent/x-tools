import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { ToolError } from "../core"
import { PROJECT } from "../project"
import { handleCommandError, parseCommandStateDir, parseFlagArgs } from "./command-args"
import { EXIT_FAILED, EXIT_USAGE } from "./command-io"

const SPEC = { values: ["--account"], switches: ["--yes"] } as const

function collect(env: Record<string, string | undefined> = {}) {
  let stderr = ""
  return { io: { env, stdout: () => {}, stderr: (text: string) => (stderr += text) }, stderr: () => stderr }
}

describe("parseFlagArgs", () => {
  test("takes a value after the flag and after an equals sign", () => {
    expect(parseFlagArgs(["--account", "work"], SPEC).values).toEqual({ "--account": "work" })
    expect(parseFlagArgs(["--account=work"], SPEC).values).toEqual({ "--account": "work" })
  })

  test("takes a switch and leaves everything else in rest, in order", () => {
    const parsed = parseFlagArgs(["--state-dir", "/s", "--yes", "--account", "a", "extra"], SPEC)
    expect(parsed.switches.has("--yes")).toBe(true)
    expect(parsed.rest).toEqual(["--state-dir", "/s", "extra"])
  })

  test.each([
    [["--account"], "--account"],
    [["--account="], "--account"],
    [["--account", "--yes"], "--account"],
    [["--yes=true"], "--yes"],
  ])("%j is a usage error naming the flag", (argv, flag) => {
    expect(() => parseFlagArgs(argv, SPEC)).toThrow(flag)
  })
})

describe("parseCommandStateDir", () => {
  const PREFIX = PROJECT.envPrefix

  test("reads the flag in both forms and says it came from the flag", () => {
    const { io } = collect()
    expect(parseCommandStateDir(["--state-dir", "/flag"], io)).toEqual({ stateDir: "/flag", fromFlag: true })
    expect(parseCommandStateDir(["--state-dir=/flag"], io)).toEqual({ stateDir: "/flag", fromFlag: true })
  })

  test("expands ~ as the settings do", () => {
    const { io } = collect({ HOME: "/home/someone" })
    expect(parseCommandStateDir(["--state-dir", "~/state"], io).stateDir).toBe("/home/someone/state")
  })

  test("falls back to the environment, then XDG_STATE_HOME, then the home, none of them from the flag", () => {
    const home = "/home/someone"
    const env = { HOME: home, XDG_STATE_HOME: "/xdg" }
    expect(parseCommandStateDir([], collect({ ...env, [`${PREFIX}_STATE_DIR`]: "/env" }).io)).toEqual({
      stateDir: "/env",
      fromFlag: false,
    })
    expect(parseCommandStateDir([], collect(env).io)).toEqual({
      stateDir: join("/xdg", PROJECT.name),
      fromFlag: false,
    })
    expect(parseCommandStateDir([], collect({ HOME: home }).io)).toEqual({
      stateDir: join(home, ".local", "state", PROJECT.name),
      fromFlag: false,
    })
  })

  test("lets the flag win over the environment", () => {
    const { io } = collect({ [`${PREFIX}_STATE_DIR`]: "/env" })
    expect(parseCommandStateDir(["--state-dir", "/flag"], io).stateDir).toBe("/flag")
  })

  test("reads no other setting, from a flag or a variable", () => {
    const env = { [`${PREFIX}_UNATTENDED`]: "maybe", [`${PREFIX}_GRANT_KEY`]: "short" }
    expect(parseCommandStateDir(["--state-dir", "/flag"], collect(env).io).stateDir).toBe("/flag")
    for (const arg of ["--unattended", "--grants-dir=/g", "--tools=a", "--nope", "stray"]) {
      expect(() => parseCommandStateDir([arg], collect().io)).toThrow("Unknown option")
    }
  })

  test("refuses a relative path", () => {
    expect(() => parseCommandStateDir(["--state-dir", "relative"], collect().io)).toThrow(
      "--state-dir must be an absolute path.",
    )
  })
})

describe("handleCommandError", () => {
  test("says a tool error on one prefixed line, and picks the exit by mode", () => {
    const error = new ToolError("not_found", "lost")
    const { io, stderr } = collect()
    expect(handleCommandError(error, io)).toBe(EXIT_FAILED)
    expect(stderr()).toBe(`${PROJECT.cli}: lost\n`)
    expect(handleCommandError(error, io, { mode: "usage" })).toBe(EXIT_USAGE)
    expect(handleCommandError(error, io, { mode: "auto" })).toBe(EXIT_FAILED)
    expect(handleCommandError(new ToolError("invalid_argument", "bad"), io, { mode: "auto" })).toBe(EXIT_USAGE)
  })

  test("says a cancellation only when told how, else it is unexpected", () => {
    const abort = Object.assign(new Error("stopped"), { name: "AbortError" })
    const said = collect()
    expect(handleCommandError(abort, said.io, { abortMessage: "Cancelled." })).toBe(EXIT_FAILED)
    expect(said.stderr()).toBe(`${PROJECT.cli}: Cancelled.\n`)
    const unsaid = collect()
    expect(handleCommandError(abort, unsaid.io)).toBe(EXIT_FAILED)
    expect(unsaid.stderr()).toBe(`${PROJECT.cli}: Unexpected error; the command failed.\n`)
  })

  test("says an unexpected error generically, without its message or stack", () => {
    const { io, stderr } = collect()
    expect(handleCommandError(new TypeError("secret detail"), io)).toBe(EXIT_FAILED)
    expect(stderr()).toBe(`${PROJECT.cli}: Unexpected error; the command failed.\n`)
  })
})
