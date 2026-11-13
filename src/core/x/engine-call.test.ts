import { afterEach, describe, expect, test } from "bun:test"
import { AUTH, COOKIES, CT0, failureOf } from "./cookies.testing"
import { callEngine, type EngineCallOptions } from "./engine-call"
import { BASE_REPLY, fakeEngine, type FakeEngine } from "./engine-call.testing"
import { removeTempDirs, tempDir, writeVenv } from "./engine.testing"
import { PYTHON_VERSION, TWSCRAPE_VERSION, enginePaths } from "./engine"

afterEach(removeTempDirs)

const ENV = { PATH: "/usr/bin:/bin", HOME: "/home/someone", STRAY: "leaks" }
const OK_REPLY = { ...BASE_REPLY, ok: true, data: { twscrape_version: TWSCRAPE_VERSION } } as const

function call(engine: FakeEngine, extra: Partial<EngineCallOptions> = {}) {
  return callEngine({
    stateDir: engine.stateDir,
    bridgeFile: engine.bridgeFile,
    op: "check",
    cookies: COOKIES,
    env: ENV,
    ...extra,
  })
}

describe("callEngine without an engine", () => {
  test("is not_found with the install action, and runs nothing", async () => {
    const stateDir = await tempDir()
    const error = await failureOf(
      callEngine({ stateDir, bridgeFile: "/b.py", op: "check", cookies: COOKIES, env: ENV }),
    )
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("The engine is not installed or does not match this release; run engine install.")
    expect(error.details).toEqual({ action: "engine_install", engine_status: "missing" })
  })

  test("a venv on other versions is a mismatch", async () => {
    const stateDir = await tempDir()
    await writeVenv(stateDir, { pythonVersion: PYTHON_VERSION, twscrape: "0.0.1" })
    const error = await failureOf(
      callEngine({ stateDir, bridgeFile: "/b.py", op: "check", cookies: COOKIES, env: ENV }),
    )
    expect(error.code).toBe("not_found")
    expect(error.details).toEqual({ action: "engine_install", engine_status: "mismatch" })
  })
})

describe("callEngine's call", () => {
  test("runs the venv's Python isolated on the bridge, in the engine directory", async () => {
    const engine = await fakeEngine()
    await engine.reply(OK_REPLY)
    await call(engine)
    expect((await engine.recorded("argv")).split("\n")).toEqual(["-I", "-B", engine.bridgeFile, ""])
    expect((await engine.recorded("cwd")).trim()).toBe(enginePaths(engine.stateDir).dir)
  })

  test("sends the request on standard input with the cookies, and the defaults", async () => {
    const engine = await fakeEngine()
    await engine.reply(OK_REPLY)
    await call(engine)
    expect(JSON.parse(await engine.recorded("stdin"))).toEqual({
      op: "check",
      cookies: COOKIES,
      refused: null,
      deadline: 60,
      args: {},
    })
  })

  test("sends the refused fingerprint, the arguments and the deadline it is given", async () => {
    const engine = await fakeEngine()
    await engine.reply(OK_REPLY)
    await call(engine, { refused: "feedfacefeedface", args: { handle: "someone" }, deadlineSeconds: 20 })
    expect(JSON.parse(await engine.recorded("stdin"))).toEqual({
      op: "check",
      cookies: COOKIES,
      refused: "feedfacefeedface",
      deadline: 20,
      args: { handle: "someone" },
    })
  })

  test("puts the cookies in neither the arguments nor the environment", async () => {
    const engine = await fakeEngine()
    await engine.reply(OK_REPLY)
    await call(engine, { env: { ...ENV, X_TOOLS_COOKIES_DEFAULT: COOKIES } })
    for (const record of ["argv", "env"] as const) {
      const text = await engine.recorded(record)
      expect(text).not.toContain(AUTH)
      expect(text).not.toContain(CT0)
    }
  })

  test("gives the child the fixed variables and the passed ones, and nothing else", async () => {
    const engine = await fakeEngine()
    await engine.reply(OK_REPLY)
    await call(engine, {
      env: { ...ENV, HTTPS_PROXY: "http://proxy:3128", no_proxy: "localhost", SSL_CERT_FILE: "/certs/ca.pem" },
    })
    const env = Object.fromEntries(
      (await engine.recorded("env"))
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    )
    for (const shellOwn of ["PWD", "OLDPWD", "SHLVL", "_"]) delete env[shellOwn]
    expect(env).toEqual({
      PATH: ENV.PATH,
      HOME: ENV.HOME,
      NO_COLOR: "1",
      TERM: "dumb",
      TWS_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
      TWS_LOG_LEVEL: "WARNING",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      HTTPS_PROXY: "http://proxy:3128",
      no_proxy: "localhost",
      SSL_CERT_FILE: "/certs/ca.pem",
    })
  })
})

describe("callEngine's reply", () => {
  test("returns an ok reply as it was written", async () => {
    const engine = await fakeEngine()
    await engine.reply(OK_REPLY)
    expect(await call(engine)).toEqual(OK_REPLY)
  })

  test("returns a failure reply, with its session, as a reply and not an error", async () => {
    const engine = await fakeEngine()
    const reply = {
      ...BASE_REPLY,
      ok: false,
      kind: "no_account",
      error: "no active account",
      contacted: true,
      session: { active: false, error: "locked", locks: { UserByRestId: "2030-01-01T00:00:00+00:00" } },
      warnings: ["a warning"],
    } as const
    await engine.reply(reply)
    expect(await call(engine)).toEqual(reply)
  })

  test("noise on stderr beside a reply on stdout is still a reply", async () => {
    const engine = await fakeEngine()
    await engine.reply(OK_REPLY)
    await engine.set("stderr", "twscrape: a log line\n")
    expect(await call(engine)).toEqual(OK_REPLY)
  })
})
