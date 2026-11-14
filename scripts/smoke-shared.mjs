import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { fileURLToPath } from "node:url"

export const SERVER = fileURLToPath(new URL("../dist/mcp.js", import.meta.url))
export const EXIT_USAGE = 2
export const UNKNOWN_TOOL = "unknown_nonexistent_read"
export const ACCOUNT_READ = "x_account_read"
export const POST_READ = "x_post_read"
export const USER_READ = "x_user_read"

/** The reads of each tool that only the reading account may answer, so they never reach FxTwitter or X: none is set up in the empty state directory. */
export const ACCOUNT_ONLY_READS = [
  [
    POST_READ,
    [
      { method: "view", posts: ["20"], source: "account" },
      { method: "search", query: "x", source: "account" },
      { method: "conversation", post: "20", source: "account" },
      { method: "timeline", handle: "x", source: "account" },
    ],
  ],
  [
    USER_READ,
    [
      { method: "view", handle: "x", source: "account" },
      { method: "search", query: "x", source: "account" },
    ],
  ],
]

export function expect(condition, message) {
  if (!condition) throw new Error(message)
}

/** The tool names the MCP server lists with the given settings and `stateDir`; it draws on the same registry as the other entry points. */
export async function mcpToolNames(stateDir, args = []) {
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
