import { afterEach, describe, expect, test } from "bun:test"
import { AUTH, COOKIES, CT0, failureOf } from "./cookies.testing"
import { callEngine } from "./engine-call"
import { BASE_REPLY, fakeEngine, type FakeEngine } from "./engine-call.testing"
import { removeTempDirs } from "./engine.testing"

afterEach(removeTempDirs)

const ENV = { PATH: "/usr/bin:/bin" }

function call(engine: FakeEngine, extra: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  return callEngine({
    stateDir: engine.stateDir,
    bridgeFile: engine.bridgeFile,
    op: "check",
    cookies: COOKIES,
    env: ENV,
    ...extra,
  })
}

describe("callEngine without a reply", () => {
  test("a non-zero exit is upstream_error with the last stderr line, counted as contacted", async () => {
    const engine = await fakeEngine()
    await engine.set("stderr", "Traceback (most recent call last):\nValueError: boom\n")
    await engine.set("exit", "3")
    const error = await failureOf(call(engine))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The engine failed (exit 3): ValueError: boom")
    expect(error.details).toMatchObject({ exit_code: 3, contacted: true })
  })

  test("a non-zero exit with a valid reply is still a failure: a reply comes with exit 0", async () => {
    const engine = await fakeEngine()
    await engine.reply({ ...BASE_REPLY, ok: true, data: null })
    await engine.set("exit", "1")
    const error = await failureOf(call(engine))
    expect(error.code).toBe("upstream_error")
    expect(error.details).toMatchObject({ contacted: true })
  })

  test("output that is not JSON is upstream_error, counted as contacted", async () => {
    const engine = await fakeEngine()
    await engine.set("stdout", "this is not json\n")
    const error = await failureOf(call(engine))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The engine failed (exit 0): this is not json")
    expect(error.details).toMatchObject({ contacted: true })
  })

  test("no output at all is upstream_error", async () => {
    const engine = await fakeEngine()
    const error = await failureOf(call(engine))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The engine failed (exit 0).")
  })

  test("JSON that is not a reply is upstream_error", async () => {
    for (const stdout of [
      "[]",
      "null",
      '{"ok":true}',
      '{"ok":"yes","fingerprint":null,"contacted":false,"session":null,"warnings":[]}',
      '{"ok":false,"kind":"made_up","error":"x","fingerprint":null,"contacted":false,"session":null,"warnings":[]}',
      '{"ok":false,"kind":"error","fingerprint":null,"contacted":false,"session":null,"warnings":[]}',
    ]) {
      const engine = await fakeEngine()
      await engine.set("stdout", `${stdout}\n`)
      const error = await failureOf(call(engine))
      expect(error.code).toBe("upstream_error")
      expect(error.details).toMatchObject({ contacted: true })
    }
  })

  test("the cookies are masked in the message, whatever the child printed", async () => {
    const engine = await fakeEngine()
    await engine.set("stderr", `request failed with ${COOKIES}\nbad cookie ${CT0} for ${AUTH}\n`)
    await engine.set("exit", "1")
    const error = await failureOf(call(engine))
    expect(error.message).toBe("The engine failed (exit 1): bad cookie [masked] for [masked]")
    expect(JSON.stringify([error.message, error.details])).not.toContain(CT0)
    expect(JSON.stringify([error.message, error.details])).not.toContain(AUTH)
  })

  test("the cookies are masked when the last line is stdout garbage", async () => {
    const engine = await fakeEngine()
    await engine.set("stdout", `garbage ${COOKIES}\n`)
    const error = await failureOf(call(engine))
    expect(error.message).toBe("The engine failed (exit 0): garbage [masked]")
  })
})

describe("callEngine's runner errors", () => {
  test("a child that outlives the limit is upstream_error from the runner", async () => {
    const engine = await fakeEngine()
    await engine.set("sleep", "3")
    const error = await failureOf(call(engine, { timeoutMs: 200 }))
    expect(error.code).toBe("upstream_error")
    expect(error.message).toBe("The engine did not finish within 1 s.")
  })

  test("an aborted signal rejects with an AbortError, not a tool error", async () => {
    const engine = await fakeEngine()
    await engine.set("sleep", "3")
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const error = await call(engine, { signal: controller.signal }).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect((error as Error).name).toBe("AbortError")
  })
})
