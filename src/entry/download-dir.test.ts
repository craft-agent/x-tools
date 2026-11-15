import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { downloadDirContext } from "./download-dir"
import { parseSettings, parseTargetSettings, parseToolSettings, settingsFromOptions } from "./settings"
import { failure, profile } from "./settings.testing"

const HOME = "/home/someone"
const DEFAULT_IN_HOME = join(HOME, "Downloads", profile.name)

describe("the download_dir setting", () => {
  test("defaults to the profile's name under Downloads in the user's home", () => {
    expect(parseSettings([], {}, profile).download_dir).toBe(join(homedir(), "Downloads", profile.name))
    expect(parseSettings([], { HOME }, profile).download_dir).toBe(DEFAULT_IN_HOME)
  })

  test("a relative HOME is ignored", () => {
    expect(parseSettings([], { HOME: "relative" }, profile).download_dir).toBe(
      join(homedir(), "Downloads", profile.name),
    )
  })

  test("a flag names it, expanding ~ and beating the environment", () => {
    const env = { HOME, DEMO_DOWNLOAD_DIR: "/env/downloads" }
    expect(parseSettings(["--download-dir", "/flag/downloads"], env, profile).download_dir).toBe("/flag/downloads")
    expect(parseSettings(["--download-dir=~/mine"], env, profile).download_dir).toBe(join(HOME, "mine"))
    expect(parseSettings([], env, profile).download_dir).toBe("/env/downloads")
  })

  test("a blank value is unset", () => {
    expect(parseSettings([], { HOME, DEMO_DOWNLOAD_DIR: " " }, profile).download_dir).toBe(DEFAULT_IN_HOME)
  })

  test("a relative value is invalid_argument", () => {
    expect(failure(() => parseSettings(["--download-dir", "relative"], {}, profile)).message).toContain(
      "--download-dir",
    )
    expect(failure(() => parseSettings([], { DEMO_DOWNLOAD_DIR: "relative" }, profile)).message).toContain(
      "DEMO_DOWNLOAD_DIR",
    )
    expect(failure(() => settingsFromOptions({ download_dir: "relative" }, {}, profile)).message).toContain(
      "download_dir",
    )
  })

  test("the tool and target commands read it too", () => {
    expect(parseToolSettings(["--download-dir", "/flag/downloads"], {}, profile).download_dir).toBe("/flag/downloads")
    expect(parseTargetSettings(["--download-dir", "/flag/downloads"], {}, profile).download_dir).toBe("/flag/downloads")
    expect(parseTargetSettings([], { HOME }, profile).download_dir).toBe(DEFAULT_IN_HOME)
  })

  test("a plugin option names it, expanding ~ and beating the environment", () => {
    const env = { HOME, DEMO_DOWNLOAD_DIR: "/env/downloads" }
    expect(settingsFromOptions({ download_dir: "/option/downloads" }, env, profile).download_dir).toBe(
      "/option/downloads",
    )
    expect(settingsFromOptions({ download_dir: "~/mine" }, env, profile).download_dir).toBe(join(HOME, "mine"))
    expect(settingsFromOptions({}, env, profile).download_dir).toBe("/env/downloads")
    expect(settingsFromOptions(undefined, { HOME }, profile).download_dir).toBe(DEFAULT_IN_HOME)
  })

  test("becomes the downloadDir of a call's context", () => {
    expect(downloadDirContext({ download_dir: "/some/downloads" })).toEqual({ downloadDir: "/some/downloads" })
  })
})
