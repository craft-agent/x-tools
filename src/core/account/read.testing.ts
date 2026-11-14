import { chmod, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ToolRuntime } from "../runtime"
import { invoke, type ToolContext, type ToolOptions } from "../tool"
import { COOKIES } from "../x/cookies.testing"
import { PYTHON_VERSION, TWSCRAPE_VERSION } from "../x/engine"
import { tempDir, writeVenv } from "../x/engine.testing"
import { ensureLabelDir, type LabelPaths } from "../x/labels"
import { writePacingState, type PacingState } from "../x/pacing"
import { xAccountRead } from "./read"

/** Fixtures the account read tests share: a state directory in a fresh temporary directory, an injected clock and an environment with no `PATH`, so a program started would not be found. */

/** Where the injected clock stands. */
export const NOW = Date.parse("2026-06-01T12:00:00.000Z")

export const MINUTE_MS = 60_000

/** The command line the runtime names; its apostrophe shows what quoting does. */
const CLI = "/opt/x's cli"

/** The package's own variable prefix. */
const ENV_PREFIX = "X_TOOLS"

/** What a label's files hold: the cookie file's text (none leaves it out) and what pacing remembers. */
type LabelFiles = { cookies?: string; mode?: number; pacing?: Partial<PacingState> }

/** A state directory with a clock and the tool's context over it. */
export async function fixture(options?: ToolOptions) {
  const stateDir = join(await tempDir(), "state's directory")
  const env: Record<string, string | undefined> = { PATH: "" }
  const runtime: ToolRuntime = { envPrefix: ENV_PREFIX, cli: CLI, env, now: () => NOW }
  const ctx: ToolContext = { cwd: stateDir, stateDir, options, runtime }
  return {
    stateDir,
    env,
    runtime,
    ctx,
    /** Makes the label's directory, with the cookie file and the pacing file it is given. */
    async label(label: string, files: LabelFiles = {}): Promise<LabelPaths> {
      const paths = await ensureLabelDir(stateDir, label)
      if (files.cookies !== undefined) {
        await writeFile(paths.cookies, files.cookies)
        await chmod(paths.cookies, files.mode ?? 0o600)
      }
      if (files.pacing) {
        await writePacingState(paths, { calls: [], refused: null, rate_limited_until: null, ...files.pacing })
      }
      return paths
    },
    /** Lays out the engine as a release pins it, or as the layout says. */
    engine: (layout = { pythonVersion: PYTHON_VERSION, twscrape: TWSCRAPE_VERSION }) => writeVenv(stateDir, layout),
    read: (args: unknown = {}) => invoke(xAccountRead, args, ctx),
  }
}

/** A label with usable cookies in a file and an engine that is ready: the state of an account that can read. */
export async function readyFixture(options?: ToolOptions) {
  const h = await fixture(options)
  await h.engine()
  const paths = await h.label("default", { cookies: COOKIES })
  return { ...h, paths }
}
