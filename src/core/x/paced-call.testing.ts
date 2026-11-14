import { readFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { COOKIES } from "./cookies.testing"
import { cookieFingerprint } from "./cookies"
import { callEngine, type EngineCallOptions, type EngineReply, type EngineSession } from "./engine-call"
import { BASE_REPLY, fakeEngine, type FakeEngine } from "./engine-call.testing"
import { ensureLabelDir, type LabelPaths } from "./labels"
import { pacedCall, type PacedCallOptions } from "./paced-call"
import { DEFAULT_PACE, readPacingState, writePacingState, type PaceSettings, type PacingState } from "./pacing"

/** Fixtures the pacing tests share: a label with a fake engine, an injected clock and a record of what the engine call saw. */

/** Where the injected clock starts. */
export const T0 = Date.parse("2026-01-01T00:00:00.000Z")

/** The fingerprint of `COOKIES`, which the fake replies carry. */
export const FINGERPRINT = cookieFingerprint(COOKIES)

/** Another session's fingerprint. */
export const OTHER_FINGERPRINT = "fedcba9876543210"

export const MINUTE_MS = 60_000

/** How long a fake sleep really waits, so a lock held by another call is tried again at once. */
const REAL_WAIT_MS = 5

/** A paced label whose engine is a fake, on an injected clock. */
export type PacedFixture = {
  engine: FakeEngine
  paths: LabelPaths
  /** The injected clock; a test moves it by setting `time`. */
  clock: { time: number }
  /** Every wait the code asked for, in milliseconds. */
  sleeps: number[]
  /** What `call` was given as `refused`, once per engine call. */
  refusedArguments: (string | null)[]
  /** The engine call a paced call makes; counted in `refusedArguments`. */
  engineOptions(refused: string | null): EngineCallOptions
  /** `pacedCall` with the fixture's label, clock, sleep and engine; `extra` overrides any option. */
  run(extra?: Partial<PacedCallOptions>): Promise<EngineReply>
  /** The pacing state as stored. */
  state(): Promise<PacingState>
  /** Stores a state, as an earlier session would have left it. */
  seed(state: Partial<PacingState>): Promise<void>
}

/** A reply that says X was contacted or not, with the label's fingerprint. */
export function okReply(contacted: boolean, session: EngineSession | null = null): EngineReply {
  return { ...BASE_REPLY, fingerprint: FINGERPRINT, contacted, ok: true, data: { answer: 42 }, session }
}

/** A failed reply of the given kind. */
export function failedReply(
  kind: Extract<EngineReply, { ok: false }>["kind"],
  contacted: boolean,
  session: EngineSession | null = null,
): EngineReply {
  return { ...BASE_REPLY, fingerprint: FINGERPRINT, contacted, ok: false, kind, error: `${kind} happened`, session }
}

/** A label `default` with a ready fake engine that answers `reply`, and the pacing of `settings`. */
export async function pacedFixture(
  reply: EngineReply | null = okReply(true),
  settings: PaceSettings = DEFAULT_PACE,
): Promise<PacedFixture> {
  const engine = await fakeEngine()
  if (reply) await engine.reply(reply)
  const paths = await ensureLabelDir(engine.stateDir, "default")
  const clock = { time: T0 }
  const sleeps: number[] = []
  const refusedArguments: (string | null)[] = []
  const engineOptions = (refused: string | null): EngineCallOptions => ({
    stateDir: engine.stateDir,
    bridgeFile: engine.bridgeFile,
    op: "check",
    cookies: COOKIES,
    refused,
    env: { PATH: "/usr/bin:/bin" },
  })
  return {
    engine,
    paths,
    clock,
    sleeps,
    refusedArguments,
    engineOptions,
    run: (extra = {}) =>
      pacedCall({
        paths,
        settings,
        fingerprint: FINGERPRINT,
        call: (refused) => {
          refusedArguments.push(refused)
          return callEngine(engineOptions(refused))
        },
        now: () => clock.time,
        sleep: async (ms) => {
          sleeps.push(ms)
          await delay(Math.min(ms, REAL_WAIT_MS))
          clock.time += ms
        },
        ...extra,
      }),
    state: () => readPacingState(paths),
    seed: (state) => writePacingState(paths, { calls: [], refused: null, rate_limited_until: null, ...state }),
  }
}

/** The text of the pacing file. */
export function pacingText(fixture: PacedFixture): Promise<string> {
  return readFile(fixture.paths.pacing, "utf8")
}
