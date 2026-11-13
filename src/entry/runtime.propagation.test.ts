import { afterEach, expect, test } from "bun:test"
import { cli } from "../cli/testing"
import { call, connect, runCleanups, settings } from "../mcp/testing"
import type { V2Context, V2Tool } from "../opencode/types"
import { createV1Server } from "../opencode/v1"
import { createV2Setup } from "../opencode/v2"
import { runtimeProbe } from "./runtime.testing"

afterEach(runCleanups)

test("the command line's run and target give the tool a runtime made of its environment and profile", async () => {
  const p = runtimeProbe()
  for (const command of ["run", "target"]) {
    const result = await cli([command, p.spec.id, "--cwd", "/work"], "{}", {
      specs: [p.spec],
      env: p.options.env,
      profile: p.options.profile,
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe("")
  }
  expect(p.executions).toHaveLength(1)
  expect(p.targets).toHaveLength(1)
  p.check(p.executions[0]!, Date.now)
  p.check(p.targets[0]!, Date.now)
})

test("the MCP server gives the tool the injected runtime", async () => {
  const p = runtimeProbe()
  const { client } = await connect([p.spec], settings(), {}, p.options)
  expect((await call(client, p.spec.id)).structuredContent).toEqual({ time: 123456 })
  expect(p.executions).toHaveLength(1)
  p.check(p.executions[0]!)
})

test("the MCP server takes its toolsets from the injected profile, unless given others", async () => {
  const p = runtimeProbe()
  const own = await connect([p.spec], settings(), {}, { ...p.options, toolsets: undefined })
  expect((await own.client.listTools()).tools.map((tool) => tool.name)).toEqual([p.spec.id])
  const none = await connect([p.spec], settings(), {}, { ...p.options, toolsets: { names: [], defaults: [] } })
  expect((await none.client.listTools()).tools).toEqual([])
})

test("OpenCode V1 shares one injected runtime between targets and execution", async () => {
  const p = runtimeProbe()
  const { tool } = await createV1Server([p.spec], p.options)({})
  const context = { directory: "/work", worktree: "/work", abort: new AbortController().signal, ask: async () => {} }
  expect(await tool[p.spec.id]!.execute({}, context)).toBe('{"time":123456}')
  expect(p.targets).toHaveLength(1)
  expect(p.executions).toHaveLength(1)
  p.check(p.targets[0]!)
  p.check(p.executions[0]!)
  expect(p.targets[0]!.runtime).toBe(p.executions[0]!.runtime)
})

test("OpenCode V2 shares one injected runtime between targets and execution", async () => {
  const p = runtimeProbe()
  const tools: V2Tool[] = []
  const context: V2Context = {
    session: { get: async () => ({ location: { directory: "/work" } }) },
    permission: { assert: async () => {} },
    tool: { transform: async (callback) => callback({ add: (tool) => tools.push(tool) }) },
    skill: { transform: async () => {} },
  }
  await createV2Setup([p.spec], p.options)(context)
  const result = await tools[0]!.execute({}, { sessionID: "ses_test", signal: new AbortController().signal })
  expect(result.output).toEqual({ time: 123456 })
  expect(p.targets).toHaveLength(1)
  expect(p.executions).toHaveLength(1)
  p.check(p.targets[0]!)
  p.check(p.executions[0]!)
  expect(p.targets[0]!.runtime).toBe(p.executions[0]!.runtime)
})
