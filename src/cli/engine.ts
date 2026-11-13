import { join } from "node:path"
import { ToolError } from "../core"
import { PYTHON_VERSION, TWSCRAPE_VERSION, installEngine, readEngineState, type EngineState } from "../core/x/engine"
import { PROJECT } from "../project"
import {
  STATE_DIR_FLAG,
  handleCommandError,
  parseCommandStateDir,
  printCommandError,
  type CommandStateDir,
} from "./command-args"
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CommandIo } from "./command-io"

const USAGE = `Use engine install|status [${STATE_DIR_FLAG} <path>].`
const LOCK_FILE_PARTS = ["engine", "requirements.lock"] as const
const UNKNOWN_VERSION = "unknown"

/** What a word of a shell command line needs no quoting for. */
const SHELL_SAFE = /^[A-Za-z0-9_\/.,:=@%+-]+$/

function shellWord(value: string): string {
  return SHELL_SAFE.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
}

/** The command that installs the engine, naming the state directory only when the person named it with the flag. */
function installCommand({ stateDir, fromFlag }: CommandStateDir): string {
  const command = `${PROJECT.cli} engine install`
  return fromFlag ? `${command} ${STATE_DIR_FLAG} ${shellWord(stateDir)}` : command
}

async function install(target: CommandStateDir, io: CommandIo): Promise<number> {
  try {
    if (io.ownDir === undefined) {
      throw new ToolError("internal_error", "The directory the tools are installed in is not known.")
    }
    const state = await installEngine({
      stateDir: target.stateDir,
      lockFile: join(io.ownDir, ...LOCK_FILE_PARTS),
      env: io.env,
      signal: io.signal,
      progress: (line) => io.stderr(`${line}\n`),
    })
    io.stdout(
      `The engine is ready: twscrape ${state.twscrape_version} on Python ${state.python_version} in ${state.venv}.\n`,
    )
    return EXIT_OK
  } catch (error) {
    return handleCommandError(error, io, { abortMessage: "Cancelled." })
  }
}

function statusLines(state: EngineState, target: CommandStateDir): string[] {
  switch (state.status) {
    case "ready":
      return [
        `engine: ready (twscrape ${state.twscrape_version} on Python ${state.python_version})`,
        `venv: ${state.venv}`,
      ]
    case "missing":
      return ["engine: not installed", `run: ${installCommand(target)}`]
    case "mismatch":
      return [
        `engine: needs reinstall (found twscrape ${state.twscrape_version ?? UNKNOWN_VERSION} on Python ${state.python_version ?? UNKNOWN_VERSION}; this release pins twscrape ${TWSCRAPE_VERSION} on Python ${PYTHON_VERSION})`,
        `run: ${installCommand(target)}`,
      ]
  }
}

async function status(target: CommandStateDir, io: CommandIo): Promise<number> {
  try {
    const state = await readEngineState(target.stateDir)
    io.stdout(`${statusLines(state, target).join("\n")}\n`)
    return state.status === "ready" ? EXIT_OK : EXIT_FAILED
  } catch (error) {
    return handleCommandError(error, io)
  }
}

const ACTIONS: Partial<Record<string, (target: CommandStateDir, io: CommandIo) => Promise<number>>> = {
  install,
  status,
}

/**
 * `engine install` builds the engine's venv from the requirements file the
 * package ships; `engine status` reports what the venv holds and, when it is
 * not ready, the command that fixes it. Both take `--state-dir <path>`.
 * Progress goes to standard error; a failure is one line there and
 * `EXIT_FAILED`, a mistake in the command line is one line and `EXIT_USAGE`.
 */
export async function runEngineCommand(argv: string[], io: CommandIo): Promise<number> {
  const [name, ...rest] = argv
  const action = name !== undefined && Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined
  if (!action) {
    printCommandError(io, USAGE)
    return EXIT_USAGE
  }
  let target: CommandStateDir
  try {
    target = parseCommandStateDir(rest, io)
  } catch (error) {
    return handleCommandError(error, io, { mode: "usage" })
  }
  return action(target, io)
}
