import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { STATE_ID, stateSpec } from "../entry/options.testing"
import { EXIT_OK, EXIT_USAGE } from "./cli"
import { PROFILE, cli, json } from "./testing"

const HOME = "/home/someone"
const COMMANDS = ["run", "target"]

describe("command-line state directory", () => {
  test("run gives the tool the default under the profile's name", async () => {
    const run = await cli(["run", STATE_ID, "--cwd", "/work/project"], "", { specs: [stateSpec], env: { HOME } })
    expect(run.code).toBe(EXIT_OK)
    expect(json(run)).toEqual({ result: { state_dir: join(HOME, ".local", "state", PROFILE.name) } })
  })

  test("run follows XDG_STATE_HOME, the environment variable and the flag, in that order of strength", async () => {
    const argv = ["run", STATE_ID, "--cwd", "/work/project"]
    const xdg = await cli(argv, "", { specs: [stateSpec], env: { HOME, XDG_STATE_HOME: "/xdg" } })
    expect(json(xdg).result.state_dir).toBe(join("/xdg", PROFILE.name))
    const env = { HOME, XDG_STATE_HOME: "/xdg", DEMO_STATE_DIR: "/env/state" }
    expect(json(await cli(argv, "", { specs: [stateSpec], env })).result.state_dir).toBe("/env/state")
    const flag = await cli([...argv, "--state-dir", "/flag/state"], "", { specs: [stateSpec], env })
    expect(json(flag).result.state_dir).toBe("/flag/state")
  })

  test("run and target refuse a relative state directory", async () => {
    for (const command of COMMANDS) {
      const run = await cli([command, STATE_ID, "--cwd", "/work/project", "--state-dir", "relative"], "", {
        specs: [stateSpec],
      })
      expect(run.code).toBe(EXIT_USAGE)
      expect(run.stderr).toContain("--state-dir must be an absolute path")
    }
  })

  test("target accepts the flag", async () => {
    const target = await cli(["target", STATE_ID, "--cwd", "/work/project", "--state-dir", "/flag/state"], "", {
      specs: [stateSpec],
    })
    expect(target.code).toBe(EXIT_OK)
  })
})
