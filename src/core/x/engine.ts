import { constants } from "node:fs"
import { access, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { ToolError, isToolError } from "../errors"
import type { ExecResult } from "../exec"
import { exitFailure, run, type RunOptions } from "../runner"
import { stateRoot } from "./labels"
import { isMissingPath } from "./missing-path"
import { ensurePrivateDir } from "./private-dir"

/** The Python the engine's venv runs on; a venv on any other version is rebuilt. */
export const PYTHON_VERSION = "3.12.13"

/** The twscrape release the engine runs; `engine/requirements.in` and `engine/requirements.lock` pin the same one. */
export const TWSCRAPE_VERSION = "0.21.0"

/** Where the engine lives under a state root. */
export type EnginePaths = {
  /** `<root>/engine` */
  dir: string
  /** `<root>/engine/venv` */
  venv: string
  /** `<venv>/bin/python` */
  python: string
}

/** What the venv holds, read from its files. */
export type EngineState = {
  /** `missing`: no usable venv; `mismatch`: a venv on other versions than the pins; `ready`: the pinned versions. */
  status: "missing" | "mismatch" | "ready"
  venv: string
  /** The Python version in `pyvenv.cfg`, or null when there is no usable venv or it names none. */
  python_version: string | null
  /** The version in the name of twscrape's `dist-info` directory, or null when it is not installed. */
  twscrape_version: string | null
}

/** What `installEngine` needs. */
export type InstallOptions = {
  stateDir: string
  /** The hashed requirements file the package ships. */
  lockFile: string
  /** The environment the variables uv needs are read from. */
  env: Readonly<Record<string, string | undefined>>
  signal?: AbortSignal
  /** Receives one line before each long step. */
  progress?(line: string): void
}

const UV = "uv"
const UV_INSTALL_URL = "https://docs.astral.sh/uv/getting-started/installation/"
const UV_VERSION_TIMEOUT_MS = 15_000
const VENV_TIMEOUT_MS = 5 * 60_000
const SYNC_TIMEOUT_MS = 10 * 60_000

/** uv's own settings are never read from its config files, and it draws no progress bars. */
const UV_SET = { UV_NO_CONFIG: "1", UV_NO_PROGRESS: "1" } as const

/**
 * The variables uv gets from the environment beyond the runner's base set:
 * the ones that let it find its cache and its managed Pythons, and reach the
 * network through the user's proxy and certificates.
 */
const UV_PASS = [
  "UV_CACHE_DIR",
  "UV_PYTHON_INSTALL_DIR",
  "UV_PYTHON_INSTALL_MIRROR",
  "UV_DEFAULT_INDEX",
  "UV_INDEX_URL",
  "UV_NATIVE_TLS",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const

const PYVENV_CONFIG = "pyvenv.cfg"
const PYTHON_VERSION_LINE = /^version_info\s*=\s*(\S+)\s*$/m
const TWSCRAPE_DIST_INFO = /^twscrape-(.+)\.dist-info$/

/** Where the engine lives under `stateDir`. */
export function enginePaths(stateDir: string): EnginePaths {
  const dir = stateRoot(stateDir).engine
  const venv = join(dir, "venv")
  return { dir, venv, python: join(venv, "bin", "python") }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function listOrEmpty(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if (isMissingPath(error)) return []
    throw error
  }
}

async function twscrapeVersion(venv: string): Promise<string | null> {
  const lib = join(venv, "lib")
  const pythons = (await listOrEmpty(lib)).filter((name) => name.startsWith("python")).sort()
  for (const python of pythons) {
    for (const entry of (await listOrEmpty(join(lib, python, "site-packages"))).sort()) {
      const version = TWSCRAPE_DIST_INFO.exec(entry)?.[1]
      if (version !== undefined) return version
    }
  }
  return null
}

/**
 * Reads what the venv under `stateDir` holds, from its files alone: it runs
 * no program. A venv whose interpreter is not an executable file, or that has
 * no readable `pyvenv.cfg`, is `missing`; one whose Python or twscrape differs
 * from the pins is `mismatch`.
 */
export async function readEngineState(stateDir: string): Promise<EngineState> {
  const { venv, python } = enginePaths(stateDir)
  const missing: EngineState = { status: "missing", venv, python_version: null, twscrape_version: null }
  if (!(await isExecutableFile(python))) return missing
  let config: string
  try {
    config = await readFile(join(venv, PYVENV_CONFIG), "utf8")
  } catch {
    return missing
  }
  const python_version = PYTHON_VERSION_LINE.exec(config)?.[1] ?? null
  const twscrape_version = await twscrapeVersion(venv)
  const ready = python_version === PYTHON_VERSION && twscrape_version === TWSCRAPE_VERSION
  return { status: ready ? "ready" : "mismatch", venv, python_version, twscrape_version }
}

async function requireReadableFile(path: string): Promise<void> {
  try {
    if ((await stat(path)).isFile()) {
      await access(path, constants.R_OK)
      return
    }
  } catch {
    // Reported below, the same way as a directory.
  }
  throw new ToolError("internal_error", `The engine's requirements file is missing from the package: ${path}.`)
}

function uvOptions(options: InstallOptions, timeoutMs: number): RunOptions {
  return { env: options.env, pass: UV_PASS, set: UV_SET, timeoutMs, signal: options.signal, name: UV }
}

async function runUv(args: string[], options: InstallOptions, timeoutMs: number): Promise<ExecResult> {
  const result = await run([UV, ...args], uvOptions(options, timeoutMs))
  if (result.code !== 0) throw exitFailure(result, UV)
  return result
}

async function requireUv(options: InstallOptions): Promise<void> {
  try {
    await runUv(["--version"], options, UV_VERSION_TIMEOUT_MS)
  } catch (error) {
    if (isToolError(error) && error.code === "not_found") {
      throw new ToolError("not_found", `uv was not found; install it (${UV_INSTALL_URL}) and run this again.`, {
        cause: error,
        details: { program: UV },
      })
    }
    throw error
  }
}

function notReady(state: EngineState): ToolError {
  const found = (version: string | null) => version ?? "none"
  return new ToolError(
    "upstream_error",
    `The engine is not ready after the install: found twscrape ${found(state.twscrape_version)} on Python ${found(state.python_version)}, but this release pins twscrape ${TWSCRAPE_VERSION} on Python ${PYTHON_VERSION}.`,
    {
      details: {
        found_twscrape: state.twscrape_version,
        found_python: state.python_version,
        pinned_twscrape: TWSCRAPE_VERSION,
        pinned_python: PYTHON_VERSION,
      },
    },
  )
}

/**
 * Builds the engine's venv under `stateDir` with uv from the pinned, hashed
 * requirements in `lockFile`, and returns its state, which is `ready`.
 *
 * A venv on another Python than the pin is rebuilt, never reused; one on the
 * pinned Python is kept and its packages are synced to the lock file, which
 * installs nothing unpinned and removes what the file does not list. A missing
 * uv is `not_found` with how to install it, a failing uv is `upstream_error`
 * with its last line, and a venv that is not `ready` afterwards is
 * `upstream_error`. The state root and `engine/` are created with mode 700.
 */
export async function installEngine(options: InstallOptions): Promise<EngineState> {
  await requireReadableFile(options.lockFile)
  await requireUv(options)

  const { root } = stateRoot(options.stateDir)
  const { dir, venv, python } = enginePaths(options.stateDir)
  await ensurePrivateDir(root)
  await ensurePrivateDir(dir)

  if ((await readEngineState(options.stateDir)).python_version !== PYTHON_VERSION) {
    options.progress?.(`Creating the engine's Python ${PYTHON_VERSION} environment…`)
    await runUv(
      ["venv", venv, "--python", PYTHON_VERSION, "--managed-python", "--clear", "--quiet"],
      options,
      VENV_TIMEOUT_MS,
    )
  }

  options.progress?.(`Installing twscrape ${TWSCRAPE_VERSION} from the pinned requirements…`)
  await runUv(
    ["pip", "sync", "--python", python, "--require-hashes", "--strict", "--quiet", options.lockFile],
    options,
    SYNC_TIMEOUT_MS,
  )

  const state = await readEngineState(options.stateDir)
  if (state.status !== "ready") throw notReady(state)
  return state
}
