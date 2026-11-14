import { expect, test } from "bun:test"
import { PROJECT } from "../project"
import { PROJECT_PROFILE } from "./profile"
import { createToolRuntime } from "./runtime"
import { runtimeFixture } from "./runtime.testing"

test("the runtime keeps the injected references and reads nothing while it is made", () => {
  const options = runtimeFixture()
  options.env = new Proxy(
    {},
    {
      get: () => {
        throw new Error("must not read the environment")
      },
    },
  )
  const runtime = createToolRuntime(options)
  expect(runtime.envPrefix).toBe(options.profile.envPrefix)
  expect(runtime.cli).toBe(PROJECT.cli)
  expect(runtime.env).toBe(options.env)
  expect(runtime.now).toBe(options.now)
  expect(options.now).not.toHaveBeenCalled()
})

test("the defaults are the package's identity, the process environment and the clock", () => {
  const runtime = createToolRuntime()
  expect(runtime.envPrefix).toBe(PROJECT_PROFILE.envPrefix)
  expect(runtime.cli).toBe(PROJECT.cli)
  expect(runtime.userAgent).toBe(`${PROJECT.name}/0.0.0 (+${PROJECT.homepage})`)
  expect(runtime.env === process.env).toBe(true)
  expect(runtime.now).toBe(Date.now)
})
