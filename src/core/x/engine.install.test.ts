import { afterEach, describe, expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { isAbortError, isToolError } from "../errors"
import { PYTHON_VERSION, TWSCRAPE_VERSION, enginePaths, installEngine } from "./engine"
import { NO_UV_ENV, fakeUv, lockFile, removeTempDirs, tempDir, writeVenv } from "./engine.testing"

const PRIVATE_MODE = 0o700

afterEach(removeTempDirs)

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

/** A state directory that does not exist yet, below a fresh temporary directory. */
async function freshStateDir(): Promise<string> {
  return join(await tempDir(), "state")
}

describe("installEngine", () => {
  test("creates the venv, then syncs the lock file, and returns a ready state", async () => {
    const uv = await fakeUv()
    const file = await lockFile()
    const stateDir = await freshStateDir()
    const progress: string[] = []
    const { venv, python } = enginePaths(stateDir)

    const state = await installEngine({
      stateDir,
      lockFile: file,
      env: uv.env,
      progress: (line) => progress.push(line),
    })

    expect(state).toEqual({
      status: "ready",
      venv,
      python_version: PYTHON_VERSION,
      twscrape_version: TWSCRAPE_VERSION,
    })
    expect(await uv.calls()).toEqual([
      "--version",
      `venv ${venv} --python ${PYTHON_VERSION} --managed-python --clear --quiet`,
      `pip sync --python ${python} --require-hashes --strict --quiet ${file}`,
    ])
    expect(progress).toEqual([
      `Creating the engine's Python ${PYTHON_VERSION} environment…`,
      `Installing twscrape ${TWSCRAPE_VERSION} from the pinned requirements…`,
    ])
    expect(await mode(stateDir)).toBe(PRIVATE_MODE)
    expect(await mode(enginePaths(stateDir).dir)).toBe(PRIVATE_MODE)
  })

  test("gives uv its fixed settings and the passed variables, and nothing stray", async () => {
    const uv = await fakeUv()
    await installEngine({ stateDir: await freshStateDir(), lockFile: await lockFile(), env: uv.env })
    const environments = await uv.environments()
    expect(environments).toHaveLength(3)
    for (const line of environments) expect(line).toBe("UV_NO_CONFIG=1 UV_CACHE_DIR=/cache/uv STRAY=")
  })

  test("keeps a venv on the pinned Python and only syncs it", async () => {
    const uv = await fakeUv()
    const stateDir = await freshStateDir()
    await writeVenv(stateDir, { pythonVersion: PYTHON_VERSION, twscrape: "0.20.0" })

    const state = await installEngine({ stateDir, lockFile: await lockFile(), env: uv.env })

    expect(state.status).toBe("ready")
    expect((await uv.calls()).map((call) => call.split(" ").slice(0, 2).join(" "))).toEqual(["--version", "pip sync"])
  })

  test("rebuilds a venv on another Python with --clear", async () => {
    const uv = await fakeUv()
    const stateDir = await freshStateDir()
    await writeVenv(stateDir, { pythonVersion: "3.11.9", twscrape: TWSCRAPE_VERSION })

    const state = await installEngine({ stateDir, lockFile: await lockFile(), env: uv.env })

    expect(state.python_version).toBe(PYTHON_VERSION)
    const calls = await uv.calls()
    expect(calls).toHaveLength(3)
    expect(calls[1]).toContain("venv ")
    expect(calls[1]).toContain(" --clear ")
  })

  test("rebuilds a venv that has no interpreter left", async () => {
    const uv = await fakeUv()
    const stateDir = await freshStateDir()
    await writeVenv(stateDir, { python: false, pythonVersion: PYTHON_VERSION, twscrape: TWSCRAPE_VERSION })

    await installEngine({ stateDir, lockFile: await lockFile(), env: uv.env })

    expect((await uv.calls())[1]).toContain("venv ")
  })

  test("sets the state root and the engine directory to mode 700 when they existed with another mode", async () => {
    const uv = await fakeUv()
    const stateDir = await tempDir()
    await installEngine({ stateDir, lockFile: await lockFile(), env: uv.env })
    expect(await mode(stateDir)).toBe(PRIVATE_MODE)
    expect(await mode(enginePaths(stateDir).dir)).toBe(PRIVATE_MODE)
  })
})

describe("installEngine failures", () => {
  test("a lock file that is not there is an internal_error, and nothing runs or is created", async () => {
    const uv = await fakeUv()
    const stateDir = await freshStateDir()
    const missing = join(await tempDir(), "requirements.lock")

    const error = await failure(installEngine({ stateDir, lockFile: missing, env: uv.env }))

    expect(isToolError(error) && error.code).toBe("internal_error")
    expect((error as Error).message).toBe(`The engine's requirements file is missing from the package: ${missing}.`)
    expect(await uv.calls()).toEqual([])
    expect(await failure(stat(stateDir))).toBeDefined()
  })

  test("a lock file that is a directory is the same error", async () => {
    const uv = await fakeUv()
    const directory = await tempDir()
    const error = await failure(installEngine({ stateDir: await freshStateDir(), lockFile: directory, env: uv.env }))
    expect(isToolError(error) && error.code).toBe("internal_error")
  })

  test("a missing uv is not_found and says how to install it", async () => {
    const error = await failure(
      installEngine({ stateDir: await freshStateDir(), lockFile: await lockFile(), env: NO_UV_ENV }),
    )
    expect(isToolError(error) && error.code).toBe("not_found")
    expect((error as Error).message).toBe(
      "uv was not found; install it (https://docs.astral.sh/uv/getting-started/installation/) and run this again.",
    )
  })

  test("a uv that fails to create the venv is upstream_error with its last line of stderr", async () => {
    const uv = await fakeUv()
    await uv.set("fail-venv", "warning: first\nerror: no Python 3.12.13 found\n")
    const error = await failure(
      installEngine({ stateDir: await freshStateDir(), lockFile: await lockFile(), env: uv.env }),
    )
    expect(isToolError(error) && error.code).toBe("upstream_error")
    expect((error as Error).message).toBe("uv failed (exit 2): error: no Python 3.12.13 found")
  })

  test("a uv that fails to sync is upstream_error with its last line of stderr", async () => {
    const uv = await fakeUv()
    await uv.set("fail-sync", "error: hash mismatch\n")
    const error = await failure(
      installEngine({ stateDir: await freshStateDir(), lockFile: await lockFile(), env: uv.env }),
    )
    expect(isToolError(error) && error.code).toBe("upstream_error")
    expect((error as Error).message).toBe("uv failed (exit 3): error: hash mismatch")
  })

  test("a venv that is not ready after the sync is upstream_error naming what was found against the pins", async () => {
    const uv = await fakeUv()
    await uv.set("twscrape-version", "0.20.0")
    const error = await failure(
      installEngine({ stateDir: await freshStateDir(), lockFile: await lockFile(), env: uv.env }),
    )
    expect(isToolError(error) && error.code).toBe("upstream_error")
    expect((error as Error).message).toBe(
      `The engine is not ready after the install: found twscrape 0.20.0 on Python ${PYTHON_VERSION}, but this release pins twscrape ${TWSCRAPE_VERSION} on Python ${PYTHON_VERSION}.`,
    )
  })

  test("a venv on another Python after the build is upstream_error too", async () => {
    const uv = await fakeUv()
    await uv.set("python-version", "3.11.9")
    const error = await failure(
      installEngine({ stateDir: await freshStateDir(), lockFile: await lockFile(), env: uv.env }),
    )
    expect(isToolError(error) && error.code).toBe("upstream_error")
    expect((error as Error).message).toContain("on Python 3.11.9")
  })

  test("an aborted signal rejects with the abort and runs nothing", async () => {
    const uv = await fakeUv()
    const controller = new AbortController()
    controller.abort()
    const error = await failure(
      installEngine({
        stateDir: await freshStateDir(),
        lockFile: await lockFile(),
        env: uv.env,
        signal: controller.signal,
      }),
    )
    expect(isAbortError(error)).toBe(true)
    expect(await uv.calls()).toEqual([])
  })
})
