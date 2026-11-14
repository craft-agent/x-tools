import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url))
const SERVER = fileURLToPath(new URL("../dist/mcp.js", import.meta.url))
const EXIT_FAILED = 1
const EXIT_USAGE = 2
const UNKNOWN_TOOL = "unknown_nonexistent_read"
const ACCOUNT_READ = "x_account_read"
const POST_READ = "x_post_read"
/** A read that only the reading account may answer, so that it never reaches FxTwitter or X: none is set up in the empty state directory. */
const POST_VIEW_ACCOUNT_ONLY = JSON.stringify({ method: "view", posts: ["20"], source: "account" })
const POST_SEARCH_ACCOUNT_ONLY = JSON.stringify({ method: "search", query: "x", source: "account" })
const stateDir = mkdtempSync(join(tmpdir(), "cli-smoke-"))

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function cli(args, input = "") {
  return spawnSync(process.execPath, [CLI, ...args, "--state-dir", stateDir], {
    encoding: "utf8",
    input,
    stdio: "pipe",
  })
}

/** The tool names the MCP server lists with the given settings; it draws on the same registry as the CLI. */
async function mcpToolNames(args) {
  const client = new Client({ name: "smoke", version: "0.0.0" })
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [SERVER, ...args, "--state-dir", stateDir] }),
  )
  try {
    return (await client.listTools()).tools.map((tool) => tool.name)
  } finally {
    await client.close()
  }
}

async function listsTheServersTools() {
  for (const settings of [[], ["--toolsets", "all"], ["--toolsets", "all", "--read-only"]]) {
    const label = ["list", ...settings].join(" ")
    const run = cli(["list", ...settings])
    expect(run.status === 0, `Expected exit 0 for ${label}, got ${run.status}: ${run.stderr}`)
    const listed = JSON.parse(run.stdout)
    for (const id of [ACCOUNT_READ, POST_READ]) {
      expect(
        listed.some((tool) => tool.id === id && tool.class === "read"),
        `Expected ${label} to include ${id} as a read tool, got ${run.stdout}`,
      )
    }
    const expected = await mcpToolNames(settings)
    expect(
      JSON.stringify(listed.map((tool) => tool.id)) === JSON.stringify(expected),
      `Expected ${label} to give ${JSON.stringify(expected)}, got ${run.stdout}`,
    )
    for (const tool of listed) {
      expect(
        typeof tool.title === "string" && typeof tool.class === "string" && tool.input_schema?.type === "object",
        `Expected a described tool, got ${JSON.stringify(tool)}`,
      )
    }
    console.log(`${label} gives the ${listed.length} tools the MCP server lists.`)
  }
}

function readsEmptyAccounts() {
  for (const settings of [[], ["--read-only"]]) {
    const run = cli(["run", ACCOUNT_READ, "--cwd", process.cwd(), ...settings], "{}")
    expect(run.status === 0, `Expected ${ACCOUNT_READ} to succeed, got ${run.status}: ${run.stdout}${run.stderr}`)
    const { result } = JSON.parse(run.stdout)
    expect(
      Array.isArray(result?.accounts) && result.accounts.length === 0 && result.engine?.status === "missing",
      `Expected no accounts and a missing engine from an empty state directory, got ${run.stdout}`,
    )
  }
  expect(readdirSync(stateDir).length === 0, "Account reads must not create state")
  console.log(`${ACCOUNT_READ} returns no accounts and a missing engine from an empty state directory.`)
}

function expectCliRunError(tool, input, expectedCode, label) {
  const run = cli(["run", tool, "--cwd", process.cwd()], input)
  const code = JSON.parse(run.stdout).error?.code
  expect(
    run.status === EXIT_FAILED && code === expectedCode,
    `Expected exit ${EXIT_FAILED} and ${expectedCode} for ${label}, got ${run.status}: ${run.stdout}${run.stderr}`,
  )
}

function viewsNoPostWithoutAReadingAccount() {
  expectCliRunError(POST_READ, POST_VIEW_ACCOUNT_ONLY, "not_found", `${POST_READ} view with no reading account`)
  expectCliRunError(POST_READ, POST_SEARCH_ACCOUNT_ONLY, "not_found", `${POST_READ} search with no reading account`)
  expect(readdirSync(stateDir).length === 0, "Post reads without a reading account must not create state")
  console.log(
    `${POST_READ} view and search with source account exit ${EXIT_FAILED} with not_found and no reading account.`,
  )
}

function rejectsAnUnknownTool() {
  expectCliRunError(UNKNOWN_TOOL, "{}", "invalid_argument", UNKNOWN_TOOL)
  console.log(`run ${UNKNOWN_TOOL} exits ${EXIT_FAILED} with invalid_argument.`)
}

function rejectsConfirm() {
  const run = cli(["list", "--confirm", "x"])
  expect(run.status === EXIT_USAGE, `Expected exit ${EXIT_USAGE} for --confirm x, got ${run.status}: ${run.stderr}`)
  expect(run.stdout === "", `Expected nothing on stdout for --confirm x, got: ${run.stdout}`)
  console.log(`--confirm x exits ${EXIT_USAGE}: ${run.stderr.trim()}`)
}

try {
  await listsTheServersTools()
  readsEmptyAccounts()
  viewsNoPostWithoutAReadingAccount()
  rejectsAnUnknownTool()
  rejectsConfirm()
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(stateDir, { recursive: true, force: true })
}
