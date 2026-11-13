import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PYTHON_VERSION, TWSCRAPE_VERSION, enginePaths, readEngineState } from "./engine"
import { removeTempDirs, tempDir, writeVenv } from "./engine.testing"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

afterEach(removeTempDirs)

describe("the pins", () => {
  test("engine/requirements.in and engine/requirements.lock pin the twscrape version of the code", async () => {
    const requirements = await readFile(join(REPO_ROOT, "engine", "requirements.in"), "utf8")
    const lock = await readFile(join(REPO_ROOT, "engine", "requirements.lock"), "utf8")
    expect(requirements).toMatch(new RegExp(`^twscrape==${TWSCRAPE_VERSION.replaceAll(".", "\\.")}\\s*$`, "m"))
    expect(lock).toMatch(new RegExp(`^twscrape==${TWSCRAPE_VERSION.replaceAll(".", "\\.")} \\\\$`, "m"))
  })
})

describe("enginePaths", () => {
  test("puts the venv in the engine directory of the state root", () => {
    expect(enginePaths("/state")).toEqual({
      dir: "/state/engine",
      venv: "/state/engine/venv",
      python: "/state/engine/venv/bin/python",
    })
  })

  test("refuses a relative state directory", () => {
    expect(() => enginePaths("state")).toThrow("State directory must be absolute")
  })
})

describe("readEngineState", () => {
  test("is missing without a venv, with nothing else known", async () => {
    const stateDir = await tempDir()
    expect(await readEngineState(stateDir)).toEqual({
      status: "missing",
      venv: enginePaths(stateDir).venv,
      python_version: null,
      twscrape_version: null,
    })
  })

  test("is missing without an interpreter, or without pyvenv.cfg", async () => {
    const noPython = await tempDir()
    await writeVenv(noPython, { python: false, pythonVersion: PYTHON_VERSION, twscrape: TWSCRAPE_VERSION })
    expect((await readEngineState(noPython)).status).toBe("missing")
    const noConfig = await tempDir()
    await writeVenv(noConfig, { twscrape: TWSCRAPE_VERSION })
    expect((await readEngineState(noConfig)).status).toBe("missing")
  })

  test("is missing when the interpreter is not executable or is a directory", async () => {
    const stateDir = await tempDir()
    await writeVenv(stateDir, { pythonVersion: PYTHON_VERSION, twscrape: TWSCRAPE_VERSION })
    await chmod(enginePaths(stateDir).python, 0o644)
    expect((await readEngineState(stateDir)).status).toBe("missing")
    const directory = await tempDir()
    await writeVenv(directory, { python: false, pythonVersion: PYTHON_VERSION })
    await mkdir(enginePaths(directory).python)
    expect((await readEngineState(directory)).status).toBe("missing")
  })

  test("is ready on the pinned Python and twscrape", async () => {
    const stateDir = await tempDir()
    await writeVenv(stateDir, { pythonVersion: PYTHON_VERSION, twscrape: TWSCRAPE_VERSION })
    expect(await readEngineState(stateDir)).toEqual({
      status: "ready",
      venv: enginePaths(stateDir).venv,
      python_version: PYTHON_VERSION,
      twscrape_version: TWSCRAPE_VERSION,
    })
  })

  test("follows a symlinked interpreter, as uv makes one", async () => {
    const stateDir = await tempDir()
    await writeVenv(stateDir, { python: false, pythonVersion: PYTHON_VERSION, twscrape: TWSCRAPE_VERSION })
    const target = join(await tempDir(), "python3.12")
    await writeFile(target, "#!/bin/sh\n")
    await chmod(target, 0o755)
    await symlink(target, enginePaths(stateDir).python)
    expect((await readEngineState(stateDir)).status).toBe("ready")
  })

  test("is a mismatch on another Python, another twscrape, or no twscrape, saying what it found", async () => {
    const cases = [
      { pythonVersion: "3.11.9", twscrape: TWSCRAPE_VERSION },
      { pythonVersion: PYTHON_VERSION, twscrape: "0.20.0" },
      { pythonVersion: PYTHON_VERSION },
    ]
    for (const layout of cases) {
      const stateDir = await tempDir()
      await writeVenv(stateDir, layout)
      const state = await readEngineState(stateDir)
      expect(state.status).toBe("mismatch")
      expect(state.python_version).toBe(layout.pythonVersion)
      expect(state.twscrape_version).toBe(layout.twscrape ?? null)
    }
  })

  test("is a mismatch when pyvenv.cfg names no Python version", async () => {
    const stateDir = await tempDir()
    await writeVenv(stateDir, { twscrape: TWSCRAPE_VERSION })
    await writeFile(join(enginePaths(stateDir).venv, "pyvenv.cfg"), "home = /somewhere\n")
    expect(await readEngineState(stateDir)).toMatchObject({ status: "mismatch", python_version: null })
  })
})
