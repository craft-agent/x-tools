import { readdir } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { ToolError } from "../errors"
import { isMissingPath } from "./missing-path"
import { ensurePrivateDir } from "./private-dir"

/** The label used when none is given. */
export const DEFAULT_LABEL = "default"

/** 1 to 24 lowercase letters, digits and `_`, starting and ending with a letter or digit. */
export const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9_]{0,22}[a-z0-9])?$/

/** Maximum character length of a bad label shown in error messages. */
const MAX_BAD_LABEL_PREVIEW = 40

/** The directory of the state root that holds one directory per label. */
const ACCOUNTS_DIR = "accounts"

/** The directory of the state root that holds the engine's venv. */
const ENGINE_DIR = "engine"

/** The directory of the state root that holds FxTwitter's pacing. */
const FXTWITTER_DIR = "fxtwitter"

function quoteBadLabel(value: string): string {
  const truncated = value.length > MAX_BAD_LABEL_PREVIEW ? `${value.slice(0, MAX_BAD_LABEL_PREVIEW)}…` : value
  return JSON.stringify(truncated)
}

/** Whether `value` is a valid label name. */
export function isLabel(value: string): boolean {
  return typeof value === "string" && LABEL_PATTERN.test(value)
}

/** Returns the label, or throws `invalid_argument` stating the rule. */
export function checkLabel(value: string): string {
  if (!isLabel(value)) {
    throw new ToolError(
      "invalid_argument",
      `Invalid label ${quoteBadLabel(value)}: a label must be 1 to 24 lowercase letters, digits and "_", starting and ending with a letter or digit.`,
    )
  }
  return value
}

/** The state root and the directory each role keeps in it. */
export type StateRoot = {
  root: string
  /** `<root>/accounts`: one directory per label. */
  accounts: string
  /** `<root>/engine`: the venv every label shares. */
  engine: string
  /** `<root>/fxtwitter`: FxTwitter's pacing. */
  fxtwitter: string
}

/** Resolves the directories of the state root `stateDir`; throws `internal_error` for a relative one. */
export function stateRoot(stateDir: string): StateRoot {
  if (!isAbsolute(stateDir)) {
    throw new ToolError("internal_error", `State directory must be absolute; got ${JSON.stringify(stateDir)}.`)
  }
  return {
    root: stateDir,
    accounts: join(stateDir, ACCOUNTS_DIR),
    engine: join(stateDir, ENGINE_DIR),
    fxtwitter: join(stateDir, FXTWITTER_DIR),
  }
}

/** Where one label keeps its state; every path is inside `dir`. */
export type LabelPaths = {
  label: string
  /** `<root>/accounts/<label>` */
  dir: string
  /** The cookie file, when the label's cookies are not in the environment. */
  cookies: string
  /** The read lock: one read of X at a time for the label, across processes. */
  lock: string
  /** The call times and what X last made of the session. */
  pacing: string
}

/** Resolves the state paths for `label`; throws `invalid_argument` for a bad label and `internal_error` for a relative `stateDir`. */
export function labelPaths(stateDir: string, label: string): LabelPaths {
  const { accounts } = stateRoot(stateDir)
  checkLabel(label)
  const dir = join(accounts, label)
  return { label, dir, cookies: join(dir, "cookies"), lock: join(dir, "read.lock"), pacing: join(dir, "pacing.json") }
}

/**
 * The labels that have a state directory, sorted.
 *
 * A missing `accounts/` gives `[]`. Entries that are not real directories
 * (such as symlinks) or whose names are not valid labels are skipped, and
 * the siblings of `accounts/` are never looked at.
 */
export async function listLabels(stateDir: string): Promise<string[]> {
  const { accounts } = stateRoot(stateDir)
  try {
    const entries = await readdir(accounts, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && isLabel(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (isMissingPath(error)) return []
    throw error
  }
}

/**
 * Picks the label a call works on, from its `account` argument:
 * - given: checked, and it must be among `listLabels`, else `not_found` naming the label and listing the known ones (or saying none is set up);
 * - absent with exactly one label: that one;
 * - absent with none: `not_found`, "No reading account is set up yet.";
 * - absent with several: `invalid_argument`, "Several reading accounts are set up; name one with `account`: a, b."
 *
 * The errors that list labels carry them as `details.known_accounts`.
 */
export async function pickLabel(stateDir: string, account?: string): Promise<LabelPaths> {
  const labels = await listLabels(stateDir)
  const details = { known_accounts: labels }

  if (account !== undefined) {
    const label = checkLabel(account)
    if (!labels.includes(label)) {
      const known = labels.length > 0 ? `known accounts: ${labels.join(", ")}.` : "no reading account is set up yet."
      throw new ToolError("not_found", `Reading account "${label}" was not found; ${known}`, { details })
    }
    return labelPaths(stateDir, label)
  }

  if (labels.length === 0) {
    throw new ToolError("not_found", "No reading account is set up yet.", { details })
  }
  if (labels.length > 1) {
    throw new ToolError(
      "invalid_argument",
      `Several reading accounts are set up; name one with \`account\`: ${labels.join(", ")}.`,
      { details },
    )
  }
  return labelPaths(stateDir, labels[0]!)
}

/**
 * Creates the state root, `accounts/` and the label's directory, each with
 * mode 700 (see `ensurePrivateDir`), refusing with `invalid_argument` a
 * symlink or a file where one of them should be. Returns the paths.
 */
export async function ensureLabelDir(stateDir: string, label: string): Promise<LabelPaths> {
  const paths = labelPaths(stateDir, label)
  const { root, accounts } = stateRoot(stateDir)
  await ensurePrivateDir(root)
  await ensurePrivateDir(accounts)
  await ensurePrivateDir(paths.dir)
  return paths
}
