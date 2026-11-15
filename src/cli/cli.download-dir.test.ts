import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { DOWNLOAD_ID, downloadSpec } from "../entry/options.testing"
import { EXIT_OK, EXIT_USAGE } from "./cli"
import { PROFILE, cli, json } from "./testing"

const HOME = "/home/someone"
const ARGV = ["run", DOWNLOAD_ID, "--cwd", "/work/project"]

describe("command-line download directory", () => {
  test("run gives the tool the default under the profile's name", async () => {
    const run = await cli(ARGV, "", { specs: [downloadSpec], env: { HOME } })
    expect(run.code).toBe(EXIT_OK)
    expect(json(run)).toEqual({ result: { download_dir: join(HOME, "Downloads", PROFILE.name) } })
  })

  test("run follows the environment variable, then the flag", async () => {
    const env = { HOME, DEMO_DOWNLOAD_DIR: "/env/downloads" }
    expect(json(await cli(ARGV, "", { specs: [downloadSpec], env })).result.download_dir).toBe("/env/downloads")
    const flag = await cli([...ARGV, "--download-dir", "/flag/downloads"], "", { specs: [downloadSpec], env })
    expect(json(flag).result.download_dir).toBe("/flag/downloads")
  })

  test("run and target refuse a relative download directory", async () => {
    for (const command of ["run", "target"]) {
      const run = await cli([command, DOWNLOAD_ID, "--cwd", "/work/project", "--download-dir", "relative"], "", {
        specs: [downloadSpec],
      })
      expect(run.code).toBe(EXIT_USAGE)
      expect(run.stderr).toContain("--download-dir must be an absolute path")
    }
  })

  test("target accepts the flag", async () => {
    const target = await cli(
      ["target", DOWNLOAD_ID, "--cwd", "/work/project", "--download-dir", "/flag/downloads"],
      "",
      { specs: [downloadSpec] },
    )
    expect(target.code).toBe(EXIT_OK)
  })
})
