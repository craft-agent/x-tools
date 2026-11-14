import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { PLUGIN_NAME } from "./package-name.mjs"

const PLUGIN = fileURLToPath(new URL("../dist/opencode.js", import.meta.url))
const SERVER = fileURLToPath(new URL("../dist/mcp.js", import.meta.url))
const ACCOUNT_READ = "x_account_read"
const POST_READ = "x_post_read"
/** A read that only the reading account may answer, so that it never reaches FxTwitter or X: none is set up in the empty state directory. */
const POST_VIEW_ACCOUNT_ONLY = { method: "view", posts: ["20"], source: "account" }
const NO_ACCOUNT_ERROR = /^not_found: No reading account is set up yet\./
const stateDir = mkdtempSync(join(tmpdir(), "opencode-smoke-"))

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

/** Expects `result` to say that no account is set up and the engine is missing, as an empty state directory does. */
function expectEmptyAccounts(result, label) {
  expect(
    Array.isArray(result?.accounts) && result.accounts.length === 0 && result.engine?.status === "missing",
    `Expected ${label} to read no accounts and a missing engine, got ${JSON.stringify(result)}.`,
  )
}

/** Expects the tool call `run` to fail as `not_found` for want of a reading account. */
async function expectNoAccountError(run, label) {
  const error = await run().then(
    () => undefined,
    (failure) => failure,
  )
  expect(
    error instanceof Error && NO_ACCOUNT_ERROR.test(error.message),
    `Expected ${label} to fail with not_found for want of a reading account, got ${error instanceof Error ? error.message : JSON.stringify(error)}.`,
  )
}

/** Expects `version` to read no accounts from `ACCOUNT_READ` and fail `POST_READ` with `not_found`. */
async function checkOpenCodeVersion(version, readAccount, runPost) {
  expectEmptyAccounts(await readAccount(), `${version} ${ACCOUNT_READ}`)
  await expectNoAccountError(runPost, `${version} ${POST_READ}`)
}

/** The tool names the MCP server lists with default settings; it draws on the same registry as the plugin. */
async function mcpToolNames() {
  const client = new Client({ name: "smoke", version: "0.0.0" })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, "--state-dir", stateDir] }))
  try {
    return (await client.listTools()).tools.map((tool) => tool.name).sort()
  } finally {
    await client.close()
  }
}

try {
  const { default: plugin } = await import(pathToFileURL(PLUGIN).href)
  expect(
    typeof plugin?.id === "string" && typeof plugin.setup === "function" && typeof plugin.server === "function",
    `Expected a default export with id, setup and server, got ${JSON.stringify(Object.keys(plugin ?? {}))}.`,
  )
  expect(plugin.id === PLUGIN_NAME, `Expected the plugin to be named ${PLUGIN_NAME}, got ${plugin.id}.`)
  console.log(`The OpenCode plugin ${plugin.id} exports setup and server.`)

  const expected = await mcpToolNames()
  for (const name of [ACCOUNT_READ, POST_READ]) {
    expect(expected.includes(name), `Expected the MCP registry to include ${name}.`)
  }

  const options = { state_dir: stateDir }
  const noPermission = async () => {
    throw new Error("Account reads must not request permission")
  }
  const signal = new AbortController().signal
  const added = new Map()
  const skills = []
  await plugin.setup({
    options,
    tool: { transform: async (callback) => callback({ add: (tool) => added.set(tool.name, tool) }) },
    skill: { transform: async (callback) => callback({ add: (skill) => skills.push(skill.id) }) },
    session: { get: async () => ({ location: { directory: process.cwd() } }) },
    permission: { assert: noPermission },
  })
  const registered = [...added.keys()].sort()
  expect(
    JSON.stringify(registered) === JSON.stringify(expected),
    `Expected setup to register ${JSON.stringify(expected)}, got ${JSON.stringify(registered)}.`,
  )
  for (const id of ["x-account", "x-posts"]) {
    expect(skills.includes(id), `Expected setup to register ${id}, got ${JSON.stringify(skills)}.`)
  }
  console.log(`setup registers ${added.size} tools (as many as the MCP server lists) and ${skills.length} skills.`)
  const v2Ctx = { sessionID: "ses_smoke", signal }
  await checkOpenCodeVersion(
    "V2",
    async () => (await added.get(ACCOUNT_READ).execute({}, v2Ctx)).output,
    () => added.get(POST_READ).execute(POST_VIEW_ACCOUNT_ONLY, v2Ctx),
  )

  const { tool } = await plugin.server({}, options)
  const served = Object.keys(tool).sort()
  expect(
    JSON.stringify(served) === JSON.stringify(expected),
    `Expected server to return ${JSON.stringify(expected)}, got ${JSON.stringify(served)}.`,
  )
  const v1Ctx = { directory: process.cwd(), worktree: process.cwd(), abort: signal, ask: noPermission }
  await checkOpenCodeVersion(
    "V1",
    async () => JSON.parse(await tool[ACCOUNT_READ].execute({}, v1Ctx)),
    () => tool[POST_READ].execute(POST_VIEW_ACCOUNT_ONLY, v1Ctx),
  )
  expect(readdirSync(stateDir).length === 0, "Account and post reads must not create state.")
  console.log(`server returns ${served.length} tools; V1 and V2 read no accounts from an empty state directory.`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(stateDir, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
