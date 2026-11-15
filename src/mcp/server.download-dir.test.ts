import { afterEach, describe, expect, test } from "bun:test"
import { DOWNLOAD_ID, downloadSpec } from "../entry/options.testing"
import { parseSettings } from "../entry/settings"
import { call, connect, runCleanups, settings } from "./testing"

afterEach(runCleanups)

describe("download directory", () => {
  test("a call's context carries the download directory of the settings", async () => {
    const { client } = await connect([downloadSpec], settings({ download_dir: "/settings/downloads" }))
    expect((await call(client, DOWNLOAD_ID)).structuredContent).toEqual({ download_dir: "/settings/downloads" })
  })

  test("the download directory comes from the command line of the server", async () => {
    const profile = {
      name: "demo-tools",
      envPrefix: "DEMO",
      toolsets: { names: ["alpha"], defaults: ["alpha"] },
      options: { download_dir: "path" } as const,
    }
    const entry = parseSettings(["--download-dir", "/flag/downloads"], { DEMO_DOWNLOAD_DIR: "/env/downloads" }, profile)
    const { client } = await connect([downloadSpec], entry)
    expect((await call(client, DOWNLOAD_ID)).structuredContent).toEqual({ download_dir: "/flag/downloads" })
  })
})
