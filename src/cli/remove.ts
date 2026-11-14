import { cookieVariable } from "../core/x/cookies"
import { pickLabel } from "../core/x/labels"
import { removeLabel } from "../core/x/removal"
import { PROJECT_PROFILE } from "../entry/profile"
import {
  ACCOUNT_FLAG,
  STATE_DIR_FLAG,
  commandLabel,
  handleCommandError,
  parseFlagArgs,
  printCommandError,
  resolveCommandStateDir,
  usageError,
} from "./command-args"
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, defaultReadLine, throwIfCancelled, type CommandIo } from "./command-io"

const YES_FLAG = "--yes"

type RemoveCommand = {
  label: string
  yes: boolean
  stateDir: string
}

function parseRemoveCommand(argv: string[], io: CommandIo): RemoveCommand {
  const { values, switches, rest } = parseFlagArgs(argv, {
    values: [ACCOUNT_FLAG, STATE_DIR_FLAG],
    switches: [YES_FLAG],
  })
  if (rest.length > 0) throw usageError(`Remove accepts only ${ACCOUNT_FLAG}, ${YES_FLAG} and ${STATE_DIR_FLAG}.`)
  const stateDir = resolveCommandStateDir(values[STATE_DIR_FLAG], io)
  const account = values[ACCOUNT_FLAG]
  if (account === undefined) throw usageError(`Option ${ACCOUNT_FLAG} is required.`)
  return { label: commandLabel(account), yes: switches.has(YES_FLAG), stateDir }
}

/** Whether the person typed the label to confirm; no answer (input ended, or cancelled) is a refusal. */
async function confirmed(label: string, dir: string, io: CommandIo): Promise<boolean> {
  io.stderr(
    `This will permanently delete the local state of "${label}" in ${dir}: its cookie file, the reads counted and X's remembered verdicts.\n`,
  )
  const prompt = `To confirm, type the label "${label}": `
  const answer = await (io.readLine?.(prompt) ?? defaultReadLine(prompt, io.signal))
  return answer === label
}

/**
 * The `remove` command: deletes everything this machine keeps for one reading
 * account (`--account`, required): its cookie file, the reads counted and X's
 * remembered verdicts. It asks the person to type the label, unless `--yes` is
 * given; without a terminal `--yes` is required. Nothing is sent to X, and
 * cookies supplied through the environment are not touched. Resolves to the
 * exit code: 0, 1 after a failure or a refusal, 2 for a mistake in the command
 * line.
 */
export async function runRemoveCommand(argv: string[], io: CommandIo): Promise<number> {
  let command: RemoveCommand
  try {
    command = parseRemoveCommand(argv, io)
  } catch (error) {
    return handleCommandError(error, io, { mode: "usage" })
  }
  const { yes, stateDir } = command

  if (!yes && !(io.isTTY ?? Boolean(process.stdin.isTTY))) {
    printCommandError(io, `Removing a reading account without a terminal requires ${YES_FLAG}.`)
    return EXIT_USAGE
  }

  try {
    throwIfCancelled(io.signal)
    const { label, dir } = await pickLabel(stateDir, command.label)
    if (!yes && !(await confirmed(label, dir, io))) {
      printCommandError(io, "Removal cancelled.")
      return EXIT_FAILED
    }

    throwIfCancelled(io.signal)
    await removeLabel({ stateDir, label })
    const variable = cookieVariable((io.profile ?? PROJECT_PROFILE).envPrefix, label)
    io.stdout(`Removed "${label}": its local state is deleted. Cookies supplied through ${variable} are not removed.\n`)
    return EXIT_OK
  } catch (error) {
    return handleCommandError(error, io, { abortMessage: "Cancelled." })
  }
}
