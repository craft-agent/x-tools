import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { PYTHON_VERSION, TWSCRAPE_VERSION, enginePaths } from "../core/x/engine"
import { removeTempDirs, tempDir, writeVenv } from "../core/x/engine.testing"
import { EXIT_FAILED, EXIT_OK } from "./cli"
import { cli } from "./testing"

afterEach(removeTempDirs)

const STATE_DIR_FLAG = "--state-dir"
const INSTALL = "x-tools-cli engine install"
const PINS = `this release pins twscrape ${TWSCRAPE_VERSION} on Python ${PYTHON_VERSION}`

describe("engine status", () => {
  test("a ready engine is reported with its venv and exits 0", async () => {
    const stateDir = await tempDir()
    await writeVenv(stateDir, { pythonVersion: PYTHON_VERSION, twscrape: TWSCRAPE_VERSION })

    const run = await cli(["engine", "status", STATE_DIR_FLAG, stateDir], "", { env: {} })

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toBe(
      `engine: ready (twscrape ${TWSCRAPE_VERSION} on Python ${PYTHON_VERSION})\nvenv: ${enginePaths(stateDir).venv}\n`,
    )
    expect(run.stderr).toBe("")
  })

  test("a missing engine says so and names the command, with the flag when the flag named the directory", async () => {
    const stateDir = await tempDir()

    const run = await cli(["engine", "status", STATE_DIR_FLAG, stateDir], "", { env: {} })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe(`engine: not installed\nrun: ${INSTALL} ${STATE_DIR_FLAG} ${stateDir}\n`)
  })

  test("the equals form of the flag counts as the flag", async () => {
    const stateDir = await tempDir()
    const run = await cli(["engine", "status", `${STATE_DIR_FLAG}=${stateDir}`], "", { env: {} })
    expect(run.stdout).toBe(`engine: not installed\nrun: ${INSTALL} ${STATE_DIR_FLAG} ${stateDir}\n`)
  })

  test("a directory from the environment or the default is not repeated in the command", async () => {
    const home = await tempDir()
    const byDefault = await cli(["engine", "status"], "", { env: { HOME: home } })
    expect(byDefault.code).toBe(EXIT_FAILED)
    expect(byDefault.stdout).toBe(`engine: not installed\nrun: ${INSTALL}\n`)

    const byEnvironment = await cli(["engine", "status"], "", { env: { HOME: home, DEMO_STATE_DIR: join(home, "s") } })
    expect(byEnvironment.stdout).toBe(`engine: not installed\nrun: ${INSTALL}\n`)
  })

  test("a flag wins over the environment, and a path with a quote or a space is single-quoted", async () => {
    const root = await tempDir()
    const stateDir = join(root, "it's here")
    const run = await cli(["engine", "status", STATE_DIR_FLAG, stateDir], "", {
      env: { DEMO_STATE_DIR: join(root, "other") },
    })
    expect(run.stdout).toBe(`engine: not installed\nrun: ${INSTALL} ${STATE_DIR_FLAG} '${root}/it'\\''s here'\n`)
  })

  test("a venv on other versions needs a reinstall, saying what it found against the pins", async () => {
    const stateDir = await tempDir()
    await writeVenv(stateDir, { pythonVersion: "3.11.9", twscrape: "0.20.0" })

    const run = await cli(["engine", "status", STATE_DIR_FLAG, stateDir], "", { env: {} })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe(
      `engine: needs reinstall (found twscrape 0.20.0 on Python 3.11.9; ${PINS})\nrun: ${INSTALL} ${STATE_DIR_FLAG} ${stateDir}\n`,
    )
  })

  test("a venv that names no versions is reported as unknown", async () => {
    const stateDir = await tempDir()
    await writeVenv(stateDir, { pythonVersion: PYTHON_VERSION })

    const run = await cli(["engine", "status"], "", { env: { DEMO_STATE_DIR: stateDir } })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe(
      `engine: needs reinstall (found twscrape unknown on Python ${PYTHON_VERSION}; ${PINS})\nrun: ${INSTALL}\n`,
    )
  })
})
