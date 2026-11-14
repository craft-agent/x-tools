import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { ensurePrivateDir } from "../x/private-dir"
import { createFxClient, type FxClient, type FxClientOptions } from "./client"
import { T0, TEST_USER_AGENT, startFakeFxTwitter, type FakeFxTwitter } from "./fxtwitter.testing"
import { DEFAULT_FX_PACE, fxPaths, readFxPacingState, writeFxPacingState, type FxPacingState } from "./pacing"

/** Fixtures the client tests share: a fake FxTwitter, a state directory and an injected clock. */

/** How long a fake sleep really waits, so a lock held by another call is tried again at once. */
const REAL_WAIT_MS = 5

/** A client over a fake FxTwitter, on an injected clock. */
export type ClientFixture = {
  fake: FakeFxTwitter
  stateDir: string
  /** The injected clock; a test moves it by setting `time`. */
  clock: { time: number }
  /** Every wait the code asked for, in milliseconds. */
  sleeps: number[]
  /** A client of the fixture's state and clock; `extra` overrides any option. */
  client(extra?: Partial<FxClientOptions>): FxClient
  /** The pacing state as stored. */
  state(): Promise<FxPacingState>
  /** Stores a state, as an earlier call would have left it. */
  seed(state: Partial<FxPacingState>): Promise<void>
  /** Stops the fake and removes the state directory. */
  dispose(): Promise<void>
}

/** A fixture whose client paces by `settings`. */
export async function clientFixture(settings = DEFAULT_FX_PACE): Promise<ClientFixture> {
  const fake = await startFakeFxTwitter()
  const stateDir = mkdtempSync(join(tmpdir(), "xfxclient-"))
  const paths = fxPaths(stateDir)
  const clock = { time: T0 }
  const sleeps: number[] = []
  return {
    fake,
    stateDir,
    clock,
    sleeps,
    client: (extra = {}) =>
      createFxClient({
        stateDir,
        userAgent: TEST_USER_AGENT,
        settings,
        connect: fake.connect,
        now: () => clock.time,
        sleep: async (ms) => {
          sleeps.push(ms)
          await delay(Math.min(ms, REAL_WAIT_MS))
          clock.time += ms
        },
        ...extra,
      }),
    state: () => readFxPacingState(paths),
    seed: async (state) => {
      await ensurePrivateDir(paths.dir)
      await writeFxPacingState(paths, { calls: [], cooldown_until: null, ...state }, clock.time)
    },
    dispose: async () => {
      await fake.stop()
      await rm(stateDir, { recursive: true, force: true })
    },
  }
}
