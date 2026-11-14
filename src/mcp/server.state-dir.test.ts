import { afterEach, describe, expect, test } from "bun:test"
import { STATE_ID, stateSpec } from "../entry/options.testing"
import { parseSettings } from "../entry/settings"
import { call, connect, runCleanups, settings } from "./testing"

afterEach(runCleanups)

describe("state directory", () => {
  test("a call's context carries the state directory of the settings", async () => {
    const { client } = await connect([stateSpec], settings({ state_dir: "/settings/state" }))
    expect((await call(client, STATE_ID)).structuredContent).toEqual({ state_dir: "/settings/state" })
  })

  test("the state directory comes from the command line of the server", async () => {
    const profile = {
      name: "demo-tools",
      envPrefix: "DEMO",
      toolsets: { names: ["alpha"], defaults: ["alpha"] },
      options: { state_dir: "path" } as const,
    }
    const entry = parseSettings(["--state-dir", "/flag/state"], { DEMO_STATE_DIR: "/env/state" }, profile)
    const { client } = await connect([stateSpec], entry)
    expect((await call(client, STATE_ID)).structuredContent).toEqual({ state_dir: "/flag/state" })
  })
})
