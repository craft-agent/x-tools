import { afterEach, describe, expect, test } from "bun:test"
import { COOKIES, failureOf } from "./cookies.testing"
import { ToolError } from "../errors"
import { callEngine } from "./engine-call"
import { removeTempDirs } from "./engine.testing"
import { T0, failedReply, okReply, pacedFixture } from "./paced-call.testing"

afterEach(removeTempDirs)

describe("pacedCall counts a read only when X may have been contacted", () => {
  test("a reply that contacted X is counted and returned", async () => {
    const fixture = await pacedFixture(okReply(true))
    const reply = await fixture.run()
    expect(reply).toEqual(okReply(true))
    expect((await fixture.state()).calls).toEqual([T0])
  })

  test("a reply that did not contact X, such as setup, is returned and not counted", async () => {
    const fixture = await pacedFixture(failedReply("setup", false))
    const reply = await fixture.run()
    expect(reply).toMatchObject({ ok: false, kind: "setup", contacted: false })
    expect((await fixture.state()).calls).toEqual([])
  })

  test("a failed reply that contacted X is counted", async () => {
    const fixture = await pacedFixture(failedReply("x_error", true))
    await fixture.run()
    expect((await fixture.state()).calls).toEqual([T0])
  })

  test("a child that died without a reply is counted, and its error is rethrown", async () => {
    const fixture = await pacedFixture(null)
    await fixture.engine.set("stderr", "Traceback\nValueError: boom\n")
    await fixture.engine.set("exit", "3")
    const error = await failureOf(fixture.run())
    expect(error.code).toBe("upstream_error")
    expect(error.details).toMatchObject({ contacted: true })
    expect((await fixture.state()).calls).toEqual([T0])
  })

  test("a timeout is counted: the request may have arrived", async () => {
    const fixture = await pacedFixture(null)
    await fixture.engine.set("sleep", "3")
    const error = await failureOf(
      fixture.run({ call: (refused) => callEngine({ ...fixture.engineOptions(refused), timeoutMs: 200 }) }),
    )
    expect(error.code).toBe("upstream_error")
    expect((await fixture.state()).calls).toEqual([T0])
  })

  test("an abort after the call started is counted", async () => {
    const fixture = await pacedFixture(null)
    await fixture.engine.set("sleep", "3")
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const error = await fixture
      .run({
        signal: controller.signal,
        call: (refused) => callEngine({ ...fixture.engineOptions(refused), signal: controller.signal }),
      })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      )
    expect((error as Error).name).toBe("AbortError")
    expect((await fixture.state()).calls).toEqual([T0])
  })

  test("a missing engine is not counted", async () => {
    const fixture = await pacedFixture(null)
    const error = await failureOf(
      fixture.run({
        call: () =>
          callEngine({
            ...fixture.engineOptions(null),
            stateDir: `${fixture.engine.stateDir}/nowhere`,
            cookies: COOKIES,
          }),
      }),
    )
    expect(error.code).toBe("not_found")
    expect(error.details).toMatchObject({ action: "engine_install" })
    expect((await fixture.state()).calls).toEqual([])
  })

  test("a program that cannot be run, or an error that says X was not contacted, is not counted", async () => {
    const fixture = await pacedFixture(null)
    const never = [
      new ToolError("forbidden", "cannot run"),
      new ToolError("upstream_error", "failed before the request", { details: { contacted: false } }),
    ]
    for (const failure of never) {
      await expect(fixture.run({ call: () => Promise.reject(failure) })).rejects.toBe(failure)
    }
    expect((await fixture.state()).calls).toEqual([])
  })

  test("any other thrown error is counted, and the same error is rethrown", async () => {
    const fixture = await pacedFixture(null)
    const failures = [
      new Error("plain"),
      new ToolError("upstream_error", "unknown"),
      new ToolError("internal_error", "bug"),
    ]
    for (const failure of failures) {
      await expect(fixture.run({ call: () => Promise.reject(failure) })).rejects.toBe(failure)
    }
    expect((await fixture.state()).calls).toHaveLength(failures.length)
  })
})
