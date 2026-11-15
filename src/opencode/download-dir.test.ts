import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { DOWNLOAD_ID, downloadSpec } from "../entry/options.testing"
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
  const { tool } = await createV1Server([downloadSpec], { profile: PROFILE, env })({}, options)
  return JSON.parse(await tool[DOWNLOAD_ID]!.execute({}, context))
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
  await createV2Setup([downloadSpec], { profile: PROFILE, env })(ctx)
  const result = await tools.get(DOWNLOAD_ID)!.execute({}, { sessionID: "ses_1", signal: new AbortController().signal })
  return result.output
}

describe.each([
  ["V1", callV1],
  ["V2", callV2],
])("%s download directory", (_name, call) => {
  test("defaults under the profile's name in Downloads", async () => {
    expect(await call(undefined, { HOME })).toEqual({ download_dir: join(HOME, "Downloads", PROFILE.name) })
  })

  test("the environment supplies it and the plugin option wins", async () => {
    expect(await call(undefined, { HOME, DEMO_DOWNLOAD_DIR: "/env/downloads" })).toEqual({
      download_dir: "/env/downloads",
    })
    expect(await call({ download_dir: "/option/downloads" }, { HOME, DEMO_DOWNLOAD_DIR: "/env/downloads" })).toEqual({
      download_dir: "/option/downloads",
    })
  })

  test("a relative option is refused", async () => {
    await expect(call({ download_dir: "relative" })).rejects.toThrow("download_dir")
  })
})
