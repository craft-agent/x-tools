import { chmod, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { PYTHON_VERSION, TWSCRAPE_VERSION, enginePaths } from "./engine"
import { tempDir, writeVenv } from "./engine.testing"
import type { EngineReply } from "./engine-call"

/** Fixtures the engine call tests share: a venv whose interpreter is a shell script standing in for the bridge. */

/** What the fake interpreter reads from files in its record directory, so a test steers it without passing it variables. */
type FakeEngineSetting = "stdout" | "stderr" | "exit" | "sleep"

/** What the fake interpreter records of each call, in files of its record directory. */
type FakeEngineRecord = "argv" | "cwd" | "stdin" | "env"

function fakeEngineScript(record: string): string {
  return `#!/bin/sh
rec='${record}'
printf '%s\\n' "$@" > "$rec/argv"
pwd > "$rec/cwd"
cat > "$rec/stdin"
env > "$rec/env"
if [ -f "$rec/stderr" ]; then cat "$rec/stderr" >&2; fi
if [ -f "$rec/sleep" ]; then sleep "$(cat "$rec/sleep")"; fi
if [ -f "$rec/stdout" ]; then cat "$rec/stdout"; fi
if [ -f "$rec/exit" ]; then exit "$(cat "$rec/exit")"; fi
`
}

/** A state directory whose engine is ready and whose interpreter is a fake bridge. */
export type FakeEngine = {
  stateDir: string
  /** A path to hand `callEngine` as the bridge; the fake never reads it. */
  bridgeFile: string
  /** Makes the fake write, exit or wait differently from now on. */
  set(setting: FakeEngineSetting, value: string): Promise<void>
  /** Makes the fake print `reply` as its one line of standard output. */
  reply(reply: EngineReply): Promise<void>
  /** What the fake recorded of its last run; the arguments are one per line. */
  recorded(record: FakeEngineRecord): Promise<string>
}

/** The fields every reply carries; a test spreads it and sets what it checks. */
export const BASE_REPLY = { fingerprint: "0123456789abcdef", contacted: false, session: null, warnings: [] } as const

/** Lays out a ready engine in a fresh state directory with a fake interpreter. */
export async function fakeEngine(): Promise<FakeEngine> {
  const stateDir = await tempDir()
  const record = await tempDir()
  await writeVenv(stateDir, { pythonVersion: PYTHON_VERSION, twscrape: TWSCRAPE_VERSION })
  const { python } = enginePaths(stateDir)
  await writeFile(python, fakeEngineScript(record))
  await chmod(python, 0o755)
  const set = (setting: FakeEngineSetting, value: string) => writeFile(join(record, setting), value)
  return {
    stateDir,
    bridgeFile: "/package/engine/bridge.py",
    set,
    reply: (reply) => set("stdout", `${JSON.stringify(reply)}\n`),
    recorded: (name) => readFile(join(record, name), "utf8"),
  }
}
