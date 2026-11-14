import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { ErrorCode } from "../errors"
import type { FxClient } from "../fxtwitter/client"
import { T0, iso, rejected } from "../fxtwitter/fxtwitter.testing"
import { fxPaths, writeFxPacingState } from "../fxtwitter/pacing"
import { removeTempDirs } from "../x/engine.testing"
import { ensurePrivateDir } from "../x/private-dir"
import { tryReadLock } from "../x/read-lock"
import type { ToolOptions } from "../tool"
import { readFromSources, type FxOutcome } from "./choose"
import { recordingRead, sourcesFixture, type SourcesFixture } from "./sources.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const STATUS = "/2/status/1"

async function getStatus(client: FxClient): Promise<FxOutcome<string>> {
  const reply = await client.get(STATUS)
  return { kind: "answer", value: `status ${reply.status}` }
}

/** Stores FxTwitter's state as an earlier call would have left it. */
async function seed(calls: number[], cooldownUntil: string | null): Promise<void> {
  const paths = fxPaths(h.stateDir)
  await ensurePrivateDir(h.stateDir)
  await ensurePrivateDir(paths.dir)
  await writeFxPacingState(paths, { calls, cooldown_until: cooldownUntil }, T0)
}

/** How FxTwitter can be down or limiting: what it is told first, then the read, and what the failure is. */
type Scenario = {
  name: string
  code: ErrorCode
  reason: string
  options?: ToolOptions
  arrange(): Promise<void>
  fxtwitter?: (client: FxClient) => Promise<FxOutcome<string>>
}

const scenarios: Scenario[] = [
  {
    name: "a 5xx",
    code: "upstream_error",
    reason: "server_error",
    arrange: async () => h.fake.route(STATUS, { status: 503 }),
  },
  {
    name: "a reply that is not JSON",
    code: "upstream_error",
    reason: "not_json",
    arrange: async () => h.fake.route(STATUS, { status: 200, body: "<html>" }),
  },
  {
    name: "a network failure",
    code: "upstream_error",
    reason: "network",
    arrange: () => h.fake.stop(),
  },
  {
    name: "a 429",
    code: "rate_limited",
    reason: "fxtwitter_429",
    arrange: async () => h.fake.route(STATUS, { status: 429, headers: { "Retry-After": "120" } }),
  },
  {
    name: "a running cooldown",
    code: "rate_limited",
    reason: "fxtwitter_cooldown",
    arrange: () => seed([], iso(T0 + 600_000)),
  },
  {
    name: "the daily cap reached",
    code: "rate_limited",
    reason: "fxtwitter_daily_cap",
    options: { fxtwitter_reads_per_day: 1 },
    arrange: () => seed([T0 - 1000], null),
  },
  {
    name: "three failures in a row",
    code: "upstream_error",
    reason: "fxtwitter_failing",
    arrange: async () => h.fake.route(STATUS, { status: 500 }),
    fxtwitter: async (client) => {
      for (let attempt = 0; attempt < 3; attempt += 1) await client.get(STATUS).catch(() => undefined)
      return getStatus(client)
    },
  },
]

describe("readFromSources with source auto: FxTwitter down or limiting", () => {
  for (const scenario of scenarios) {
    test(`${scenario.name} falls to the reading account when one is set up`, async () => {
      await scenario.arrange()
      await h.label()
      const { read, calls } = recordingRead(scenario.fxtwitter ?? getStatus)
      expect(await readFromSources(h.reader(scenario.options), "auto", read)).toEqual({
        source: "account",
        value: "account",
      })
      expect(calls).toEqual({ fxtwitter: 1, account: 1 })
    })

    test(`${scenario.name} is FxTwitter's error when no reading account is set up`, async () => {
      await scenario.arrange()
      const { read, calls } = recordingRead(scenario.fxtwitter ?? getStatus)
      const error = await rejected(readFromSources(h.reader(scenario.options), "auto", read))
      expect(error).toMatchObject({ code: scenario.code, details: { source: "fxtwitter", reason: scenario.reason } })
      expect(calls.account).toBe(0)
    })

    test(`${scenario.name} is FxTwitter's error under source fxtwitter, with a reading account set up`, async () => {
      await scenario.arrange()
      await h.label()
      const { read, calls } = recordingRead(scenario.fxtwitter ?? getStatus)
      const error = await rejected(readFromSources(h.reader(scenario.options), "fxtwitter", read))
      expect(error).toMatchObject({ code: scenario.code, details: { source: "fxtwitter", reason: scenario.reason } })
      expect(calls.account).toBe(0)
    })
  }

  test("a lock held by another read of FxTwitter falls too", async () => {
    await h.label()
    const reader = h.reader(undefined, { budgetMs: 1000 })
    await ensurePrivateDir(h.stateDir)
    await ensurePrivateDir(fxPaths(h.stateDir).dir)
    const release = tryReadLock(fxPaths(h.stateDir).lock)!
    try {
      const { read, calls } = recordingRead(getStatus)
      expect(await readFromSources(reader, "auto", read)).toEqual({ source: "account", value: "account" })
      expect(calls.account).toBe(1)
      expect(h.fake.requests).toEqual([])
    } finally {
      release()
    }
  })
})
