import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { PYTHON_VERSION, TWSCRAPE_VERSION, enginePaths } from "../core/x/engine"
import { NO_UV_ENV, fakeUv, removeTempDirs, tempDir } from "../core/x/engine.testing"
import { EXIT_FAILED, EXIT_OK } from "./cli"
import { ownDirWithLock } from "./engine.testing"
import { cli } from "./testing"

afterEach(removeTempDirs)

const STATE_DIR_FLAG = "--state-dir"

async function install(extra: string[] = [], overrides: Parameters<typeof cli>[2] = {}) {
  const uv = await fakeUv()
  const stateDir = join(await tempDir(), "state")
  const run = await cli(["engine", "install", STATE_DIR_FLAG, stateDir, ...extra], "", {
    env: uv.env,
    ownDir: await ownDirWithLock(),
    ...overrides,
  })
  return { run, uv, stateDir }
}

describe("engine install", () => {
  test("builds the engine, with progress on stderr and the result on stdout", async () => {
    const { run, uv, stateDir } = await install()
    const { venv } = enginePaths(stateDir)

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toBe(
      `The engine is ready: twscrape ${TWSCRAPE_VERSION} on Python ${PYTHON_VERSION} in ${venv}.\n`,
    )
    expect(run.stderr).toBe(
      `Creating the engine's Python ${PYTHON_VERSION} environment…\nInstalling twscrape ${TWSCRAPE_VERSION} from the pinned requirements…\n`,
    )
    expect(await uv.calls()).toHaveLength(3)
  })

  test("reads the lock file from the install directory and takes the flag with an equals sign", async () => {
    const uv = await fakeUv()
    const ownDir = await ownDirWithLock()
    const stateDir = join(await tempDir(), "state")

    const run = await cli(["engine", "install", `${STATE_DIR_FLAG}=${stateDir}`], "", { env: uv.env, ownDir })

    expect(run.code).toBe(EXIT_OK)
    expect((await uv.calls())[2]).toEndWith(` ${join(ownDir, "engine", "requirements.lock")}`)
  })

  test("takes the state directory from the environment without the flag", async () => {
    const uv = await fakeUv()
    const stateDir = join(await tempDir(), "state")

    const run = await cli(["engine", "install"], "", {
      env: { ...uv.env, DEMO_STATE_DIR: stateDir },
      ownDir: await ownDirWithLock(),
    })

    expect(run.code).toBe(EXIT_OK)
    expect(run.stdout).toContain(enginePaths(stateDir).venv)
  })

  test("says a failing uv on one line and fails", async () => {
    const uv = await fakeUv()
    await uv.set("fail-sync", "error: hash mismatch\n")
    const stateDir = join(await tempDir(), "state")

    const run = await cli(["engine", "install", STATE_DIR_FLAG, stateDir], "", {
      env: uv.env,
      ownDir: await ownDirWithLock(),
    })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe("")
    expect(run.stderr.split("\n").at(-2)).toBe("x-tools-cli: uv failed (exit 3): error: hash mismatch")
  })

  test("says a missing uv with how to install it and fails", async () => {
    const { run } = await install([], { env: NO_UV_ENV })
    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toBe(
      "x-tools-cli: uv was not found; install it (https://docs.astral.sh/uv/getting-started/installation/) and run this again.\n",
    )
  })

  test("says it was cancelled when the signal aborts", async () => {
    const controller = new AbortController()
    controller.abort()
    const { run } = await install([], { signal: controller.signal })
    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toBe("x-tools-cli: Cancelled.\n")
    expect(run.stdout).toBe("")
  })

  test("fails with one line when the package's requirements file is missing", async () => {
    const { run } = await install([], { ownDir: await tempDir() })
    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toStartWith("x-tools-cli: The engine's requirements file is missing from the package: ")
  })

  test("fails with one line when the install directory is not known", async () => {
    const { run } = await install([], { ownDir: undefined })
    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toBe("x-tools-cli: The directory the tools are installed in is not known.\n")
  })
})
