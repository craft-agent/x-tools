import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { STATE_ID, stateSpec } from "../entry/options.testing"
import { PROFILE } from "./testing"
import type { PluginOptions, V1ToolContext, V2Context, V2Tool } from "./types"
import { createV1Server } from "./v1"
import { createV2Setup } from "./v2"

type Env = Record<string, string | undefined>

const HOME = "/home/someone"

async function callV1(options?: PluginOptions, env: Env = {}) {
  const context: V1ToolContext = {
    directory: "/work/project",
    worktree: "/work/project",
    abort: new AbortController().signal,
    async ask() {},
  }
  const { tool } = await createV1Server([stateSpec], { profile: PROFILE, env })({}, options)
  return JSON.parse(await tool[STATE_ID]!.execute({}, context))
}

async function callV2(options?: PluginOptions, env: Env = {}) {
  const tools = new Map<string, V2Tool>()
  const ctx: V2Context = {
    options,
    session: { get: async () => ({ location: { directory: "/work/project" } }) },
    permission: { async assert() {} },
    tool: { transform: async (callback) => callback({ add: (tool) => tools.set(tool.name, tool) }) },
    skill: { transform: async () => {} },
  }
  await createV2Setup([stateSpec], { profile: PROFILE, env })(ctx)
  const result = await tools.get(STATE_ID)!.execute({}, { sessionID: "ses_1", signal: new AbortController().signal })
  return result.output
}

describe.each([
  ["V1", callV1],
  ["V2", callV2],
])("%s state directory", (_name, call) => {
  test("defaults under the profile's name", async () => {
    expect(await call(undefined, { HOME })).toEqual({ state_dir: join(HOME, ".local", "state", PROFILE.name) })
  })

  test("the environment supplies it and the plugin option wins", async () => {
    expect(await call(undefined, { HOME, DEMO_STATE_DIR: "/env/state" })).toEqual({ state_dir: "/env/state" })
    expect(await call({ state_dir: "/option/state" }, { HOME, DEMO_STATE_DIR: "/env/state" })).toEqual({
      state_dir: "/option/state",
    })
  })

  test("a relative option is refused", async () => {
    await expect(call({ state_dir: "relative" })).rejects.toThrow("state_dir")
  })
})
