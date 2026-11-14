import type { OptionSpec } from "./core"
import { NETWORK_PASS } from "./core/runner"

/** What makes this package itself; a project made from the starter sets these once (the setup script does). */
export const PROJECT = {
  /** The plugin, MCP server and program name. */
  name: "x-tools",
  /** The command line the Hermes plugin calls. */
  cli: "x-tools-cli",
  /** Where the package lives; FxTwitter's User-Agent names it. */
  homepage: "https://github.com/craft-agent/x-tools",
  /** Every tool ID starts with `<toolPrefix>_`. */
  toolPrefix: "x",
  /** Every setting's environment variable is `<envPrefix>_<SETTING>`. */
  envPrefix: "X_TOOLS",
  /** The toolsets, in the order `all` lists them. */
  toolsets: ["account", "posts"] as readonly string[],
  /** The toolsets on when a setting names none. */
  defaultToolsets: ["account", "posts"] as readonly string[],
  /** The package's own settings, which the tools themselves read: each snake_case name and its type, with bounds when it needs them. */
  options: {
    state_dir: "path",
    read_gap_seconds: { type: "number", integer: true, min: 1, max: 3600 },
    reads_per_hour: { type: "number", integer: true, min: 1, max: 60 },
    reads_per_day: { type: "number", integer: true, min: 1, max: 500 },
    fxtwitter_gap_ms: { type: "number", integer: true, min: 100, max: 60000 },
    fxtwitter_reads_per_day: { type: "number", integer: true, min: 1, max: 5000 },
    fxtwitter_cooldown_seconds: { type: "number", integer: true, min: 60, max: 21600 },
    account_only: "boolean",
  } as Readonly<Record<string, OptionSpec>>,
  /** The environment variables the tools read besides the settings, which Codex forwards to the server after them. */
  toolVariables: ["XDG_STATE_HOME", ...NETWORK_PASS] as readonly string[],
} as const
