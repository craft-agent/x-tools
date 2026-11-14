import { join } from "node:path"
import type { FxClient } from "../fxtwitter/client"
import { T0, startFakeFxTwitter, type FakeFxTwitter } from "../fxtwitter/fxtwitter.testing"
import type { ToolRuntime } from "../runtime"
import type { ToolContext, ToolOptions } from "../tool"
import { tempDir } from "../x/engine.testing"
import { ensureLabelDir } from "../x/labels"
import type { ReadOptions } from "../x/read"
import type { FxOutcome, SourcedRead } from "./choose"
import { createReader, type Reader, type ReaderOverrides } from "./reader"

/** Fixtures the source tests share: a state directory, a fake FxTwitter, an injected clock and a reading account that is a fake. */

/** What the fixture's runtime sends as `User-Agent`. */
export const USER_AGENT = "test-client/1.2.3 (+https://example.test)"

/** The install directory the fixture gives the tools. */
export const OWN_DIR = "/package"

/** What the fake reading account answers. */
export const ACCOUNT_ANSWER = { account: "default", data: { answer: 42 } }

/** A reader's world: a fake FxTwitter, an empty state directory and a clock that only moves when a wait asks it to. */
export type SourcesFixture = {
  fake: FakeFxTwitter
  stateDir: string
  /** The injected clock; a test moves it by setting `time`. */
  clock: { time: number }
  /** Every wait the code asked for, in milliseconds. */
  sleeps: number[]
  /** What each read of the reading account was asked, in order. */
  accountReads: ReadOptions[]
  /** The tool context over the fixture's state directory, install directory and runtime. */
  context(options?: ToolOptions): ToolContext
  /** A reader over the fixture; `overrides` replace any of its defaults. */
  reader(options?: ToolOptions, overrides?: ReaderOverrides): Reader
  /** Makes the label's state directory, which makes a reading account exist. */
  label(name?: string): Promise<void>
  /** Stops the fake FxTwitter; the state directory is removed by `removeTempDirs`. */
  dispose(): Promise<void>
}

/** A fixture whose reader asks the fake FxTwitter and the fake reading account. */
export async function sourcesFixture(): Promise<SourcesFixture> {
  const fake = await startFakeFxTwitter()
  const stateDir = await tempDir()
  const clock = { time: T0 }
  const sleeps: number[] = []
  const accountReads: ReadOptions[] = []
  const now = () => clock.time
  const runtime: ToolRuntime = { envPrefix: "TEST", cli: "test-cli", userAgent: USER_AGENT, env: {}, now }
  const context = (options?: ToolOptions): ToolContext => ({
    cwd: stateDir,
    stateDir,
    ownDir: OWN_DIR,
    options,
    runtime,
  })
  return {
    fake,
    stateDir,
    clock,
    sleeps,
    accountReads,
    context,
    reader: (options, overrides = {}) =>
      createReader(context(options), {
        now,
        sleep: async (ms) => {
          sleeps.push(ms)
          clock.time += ms
        },
        connect: fake.connect,
        readAccount: async (readOptions) => {
          accountReads.push(readOptions)
          return ACCOUNT_ANSWER
        },
        ...overrides,
      }),
    label: async (name = "default") => void (await ensureLabelDir(stateDir, name)),
    dispose: fake.stop,
  }
}

/** What a read through `recordingRead` counted: its FxTwitter function and its account function each ran this many times. */
export type ReadCalls = { fxtwitter: number; account: number }

/**
 * A read whose account function answers `"account"` and counts itself, and
 * whose FxTwitter function runs `fxtwitter` and counts itself; without
 * `fxtwitter` FxTwitter does not offer the read.
 */
export function recordingRead(fxtwitter?: (client: FxClient) => Promise<FxOutcome<string>>) {
  const calls: ReadCalls = { fxtwitter: 0, account: 0 }
  const read: SourcedRead<string> = {
    fxtwitter:
      fxtwitter &&
      (async (client) => {
        calls.fxtwitter += 1
        return fxtwitter(client)
      }),
    account: async () => {
      calls.account += 1
      return "account"
    },
  }
  return { read, calls }
}

/** An FxTwitter function that answers `value`. */
export const answers = (value: string) => async (): Promise<FxOutcome<string>> => ({ kind: "answer", value })

/** The bridge file the fixture's reader names for a read of the reading account. */
export const BRIDGE_FILE = join(OWN_DIR, "engine", "bridge.py")

/** The error `run` throws, or undefined when it does not throw. */
export function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}
