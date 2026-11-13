import { afterEach, describe, expect, test } from "bun:test"
import { readFile, stat, writeFile } from "node:fs/promises"
import { AUTH, COOKIES, CT0, failureOf } from "./cookies.testing"
import { removeTempDirs, tempDir } from "./engine.testing"
import { fakeEngine } from "./engine-call.testing"
import { ensureLabelDir } from "./labels"
import { FINGERPRINT, T0, failedReply, okReply } from "./paced-call.testing"
import { readPacingState } from "./pacing"
import { readX, type ReadOptions } from "./read"

afterEach(removeTempDirs)

const FILE_COOKIES = "auth_token=fileauthsecret42; ct0=filect0secret43"

/** A state directory with a ready fake engine, one label `default` and an injected clock. */
async function setUp(variable: string | null = COOKIES) {
  const engine = await fakeEngine()
  await engine.reply(okReply(true))
  const paths = await ensureLabelDir(engine.stateDir, "default")
  const clock = { time: T0 }
  const base: ReadOptions = {
    stateDir: engine.stateDir,
    envPrefix: "TEST",
    env: variable === null ? { PATH: "/usr/bin:/bin" } : { PATH: "/usr/bin:/bin", TEST_COOKIES_DEFAULT: variable },
    bridgeFile: engine.bridgeFile,
    op: "check",
    now: () => clock.time,
    sleep: async (ms) => {
      clock.time += ms
    },
  }
  return { engine, paths, clock, base }
}

async function sent(engine: Awaited<ReturnType<typeof setUp>>["engine"]) {
  return JSON.parse(await engine.recorded("stdin")) as Record<string, unknown>
}

describe("readX", () => {
  test("picks the only label and returns its name with the operation's data", async () => {
    const { engine, base } = await setUp()
    expect(await readX({ ...base, args: { handle: "someone" } })).toEqual({ account: "default", data: { answer: 42 } })
    expect(await sent(engine)).toEqual({
      op: "check",
      cookies: COOKIES,
      refused: null,
      deadline: 60,
      args: { handle: "someone" },
    })
  })

  test("the cookies of the variable win over the file", async () => {
    const { engine, paths, base } = await setUp()
    await writeFile(paths.cookies, FILE_COOKIES, { mode: 0o600 })
    await readX(base)
    expect((await sent(engine)).cookies).toBe(COOKIES)
  })

  test("without the variable the cookie file is read", async () => {
    const { engine, paths, base } = await setUp(null)
    await writeFile(paths.cookies, FILE_COOKIES, { mode: 0o600 })
    await readX(base)
    expect((await sent(engine)).cookies).toBe(FILE_COOKIES)
  })

  test("names the account asked for among several", async () => {
    const { engine, base } = await setUp()
    await ensureLabelDir(engine.stateDir, "work")
    expect((await failureOf(readX(base))).code).toBe("invalid_argument")
    expect(await readX({ ...base, account: "default" })).toMatchObject({ account: "default" })
    const work = await failureOf(readX({ ...base, account: "work" }))
    expect(work.code).toBe("unauthenticated")
  })

  test("with no label it is not_found and nothing runs", async () => {
    const engine = await fakeEngine()
    const error = await failureOf(
      readX({ stateDir: engine.stateDir, envPrefix: "TEST", env: {}, bridgeFile: engine.bridgeFile, op: "check" }),
    )
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("No reading account is set up yet.")
    await expect(engine.recorded("stdin")).rejects.toThrow()
  })

  test("without cookies it is unauthenticated and nothing is locked or counted", async () => {
    const { engine, paths, base } = await setUp(null)
    expect((await failureOf(readX(base))).code).toBe("unauthenticated")
    await expect(engine.recorded("stdin")).rejects.toThrow()
    await expect(stat(paths.lock)).rejects.toThrow()
  })

  test("without an engine it is not_found, before the lock is taken or anything is counted", async () => {
    const stateDir = await tempDir()
    const paths = await ensureLabelDir(stateDir, "default")
    const error = await failureOf(
      readX({
        stateDir,
        envPrefix: "TEST",
        env: { TEST_COOKIES_DEFAULT: COOKIES },
        bridgeFile: "/package/engine/bridge.py",
        op: "check",
      }),
    )
    expect(error.code).toBe("not_found")
    expect(error.details).toMatchObject({ action: "engine_install", engine_status: "missing" })
    await expect(stat(paths.lock)).rejects.toThrow()
    expect(await readPacingState(paths)).toEqual({ calls: [], refused: null, rate_limited_until: null })
  })
})

describe("readX through the pacing", () => {
  test("a failed reply is thrown as its mapped error and still counted", async () => {
    const { engine, paths, base } = await setUp()
    await engine.reply(failedReply("x_error", true))
    const error = await failureOf(readX(base))
    expect(error.code).toBe("upstream_error")
    expect(error.details).toMatchObject({ kind: "x_error", contacted: true })
    expect((await readPacingState(paths)).calls).toEqual([T0])
  })

  test("the settings of the options set the caps", async () => {
    const { base } = await setUp()
    const options = { ...base, options: { reads_per_hour: 1 } }
    await readX(options)
    const error = await failureOf(readX(options))
    expect(error.code).toBe("rate_limited")
    expect(error.details).toMatchObject({ reason: "hourly_cap" })
  })

  test("a session X refused is remembered by its fingerprint: the same cookies are refused, new ones go through", async () => {
    const { engine, base } = await setUp()
    await engine.reply(failedReply("no_account", true, { active: false, error: "locked", locks: {} }))
    expect((await failureOf(readX(base))).code).toBe("unauthenticated")
    await engine.reply(okReply(true))

    const again = await failureOf(readX(base))
    expect(again.details).toMatchObject({ reason: "refused" })

    const fresh = "auth_token=freshauthsecret77; ct0=freshct0secret88"
    expect(await readX({ ...base, env: { ...base.env, TEST_COOKIES_DEFAULT: fresh } })).toMatchObject({
      account: "default",
    })
    expect((await sent(engine)).refused).toBe(FINGERPRINT)
  })

  test("the state file is private and holds no cookie value", async () => {
    const { paths, base } = await setUp()
    await readX(base)
    expect((await stat(paths.pacing)).mode & 0o777).toBe(0o600)
    const text = await readFile(paths.pacing, "utf8")
    for (const secret of [AUTH, CT0, COOKIES]) expect(text).not.toContain(secret)
  })
})
