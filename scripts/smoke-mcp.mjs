import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PLUGIN_NAME } from "./package-name.mjs"
import { ACCOUNT_ONLY_READS, ACCOUNT_READ, EXIT_USAGE, SERVER, UNKNOWN_TOOL } from "./smoke-shared.mjs"

const stateDir = mkdtempSync(join(tmpdir(), "mcp-smoke-"))

function expectReadTool(tools, name) {
  const tool = tools.find((entry) => entry.name === name)
  if (tool?.annotations?.readOnlyHint !== true) {
    throw new Error(`Expected ${name} to be listed by default with readOnlyHint, got ${JSON.stringify(tool)}`)
  }
}

function expectErrorResult(result, expectedCode, label) {
  const [block] = result.content
  const code = block?.type === "text" ? JSON.parse(block.text).error?.code : undefined
  if (result.isError !== true || code !== expectedCode) {
    throw new Error(`Expected a ${expectedCode} error result for ${label}, got ${JSON.stringify(result)}`)
  }
}

function expectEmptyStateDir(message) {
  if (readdirSync(stateDir).length !== 0) throw new Error(message)
}

async function listTools() {
  const client = new Client({ name: "smoke", version: "0.0.0" })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, "--state-dir", stateDir] }))
  try {
    const serverName = client.getServerVersion()?.name
    if (serverName !== PLUGIN_NAME)
      throw new Error(`Expected the server to be named ${PLUGIN_NAME}, got ${serverName}.`)
    const { tools } = await client.listTools()
    console.log(`The MCP server ${serverName} lists ${tools.length} tools.`)

    expectReadTool(tools, ACCOUNT_READ)
    const read = await client.callTool({ name: ACCOUNT_READ, arguments: {} })
    const report = read.structuredContent
    if (read.isError || report?.accounts?.length !== 0 || report.engine?.status !== "missing") {
      throw new Error(`Expected no accounts and a missing engine from ${ACCOUNT_READ}, got ${JSON.stringify(read)}`)
    }
    expectEmptyStateDir("Account reads must not create state.")
    console.log(`${ACCOUNT_READ} returns no accounts and a missing engine from an empty state directory.`)

    for (const [tool, reads] of ACCOUNT_ONLY_READS) {
      expectReadTool(tools, tool)
      for (const args of reads) {
        const result = await client.callTool({ name: tool, arguments: args })
        expectErrorResult(result, "not_found", `${tool} ${args.method} with no reading account`)
      }
      expectEmptyStateDir(`${tool} reads without a reading account must not create state.`)
      console.log(
        `${tool} ${reads.map(({ method }) => method).join(", ")} with source account give a not_found error result and no reading account.`,
      )
    }

    const result = await client.callTool({ name: UNKNOWN_TOOL })
    expectErrorResult(result, "invalid_argument", UNKNOWN_TOOL)
    console.log(`Calling ${UNKNOWN_TOOL} gives an invalid_argument error result.`)
  } finally {
    await client.close()
  }
}

function rejectsBadSettings() {
  const run = spawnSync(process.execPath, [SERVER, "--toolsets", "bogus"], { encoding: "utf8", stdio: "pipe" })
  if (run.status !== EXIT_USAGE) {
    throw new Error(`Expected exit ${EXIT_USAGE} for --toolsets bogus, got ${run.status}: ${run.stderr}`)
  }
  if (run.stdout !== "") throw new Error(`Expected nothing on stdout for --toolsets bogus, got: ${run.stdout}`)
  console.log(`--toolsets bogus exits ${EXIT_USAGE}: ${run.stderr.trim()}`)
}

try {
  await listTools()
  rejectsBadSettings()
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(stateDir, { recursive: true, force: true })
}
