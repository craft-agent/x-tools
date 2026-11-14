import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readdir } from "node:fs/promises"
import { fxPaths, writeFxPacingState, type FxPacingState } from "../fxtwitter/pacing"
import { DAY_MS, HOUR_MS } from "../x/pacing"
import { removeTempDirs } from "../x/engine.testing"
import { ensurePrivateDir } from "../x/private-dir"
import { MINUTE_MS, NOW, fixture } from "./read.testing"

afterEach(removeTempDirs)

/** A fixture whose FxTwitter state is `state`. */
async function fixtureWith(state: Partial<FxPacingState>, options?: Parameters<typeof fixture>[0]) {
  const h = await fixture(options)
  const paths = fxPaths(h.stateDir)
  await ensurePrivateDir(h.stateDir)
  await ensurePrivateDir(paths.dir)
  // Written as of the day before, so that the requests older than a day are kept as they were.
  await writeFxPacingState(paths, { calls: [], cooldown_until: null, ...state }, NOW - DAY_MS)
  return h
}

describe("x_account_read: FxTwitter", () => {
  test("is on, with no requests and no cooldown, when FxTwitter has no state", async () => {
    const h = await fixture()
    expect((await h.read()).fxtwitter).toEqual({
      enabled: true,
      reads_last_day: 0,
      reads_per_day: 1000,
      cooldown_until: null,
    })
  })

  test("counts the requests of the last 24 hours only", async () => {
    const h = await fixtureWith({ calls: [NOW - DAY_MS - MINUTE_MS, NOW - DAY_MS + MINUTE_MS, NOW - HOUR_MS, NOW] })
    expect((await h.read()).fxtwitter).toMatchObject({ reads_last_day: 3 })
  })

  test("names a cooldown while it lies ahead, and no cooldown once it has passed", async () => {
    const running = await fixtureWith({ cooldown_until: new Date(NOW + 10 * MINUTE_MS).toISOString() })
    expect((await running.read()).fxtwitter.cooldown_until).toBe(new Date(NOW + 10 * MINUTE_MS).toISOString())

    const past = await fixtureWith({ cooldown_until: new Date(NOW - MINUTE_MS).toISOString() })
    expect((await past.read()).fxtwitter.cooldown_until).toBeNull()

    const ending = await fixtureWith({ cooldown_until: new Date(NOW).toISOString() })
    expect((await ending.read()).fxtwitter.cooldown_until).toBeNull()
  })

  test("takes the daily cap from the settings in force", async () => {
    const h = await fixtureWith({ calls: [NOW - HOUR_MS] }, { fxtwitter_reads_per_day: 50 })
    expect((await h.read()).fxtwitter).toMatchObject({ reads_last_day: 1, reads_per_day: 50 })
  })

  test("is off under account_only, and still reports what its state holds", async () => {
    const h = await fixtureWith({ calls: [NOW - HOUR_MS] }, { account_only: true })
    expect((await h.read()).fxtwitter).toMatchObject({ enabled: false, reads_last_day: 1 })
    const unset = await fixture({ account_only: false })
    expect((await unset.read()).fxtwitter.enabled).toBe(true)
  })

  test("creates nothing in an empty state directory", async () => {
    const h = await fixture()
    await mkdir(h.stateDir)
    await h.read()
    expect(await readdir(h.stateDir)).toEqual([])
  })
})
