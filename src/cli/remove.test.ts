import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { removeTempDirs, tempDir } from "../core/x/engine.testing"
import { stateRoot } from "../core/x/labels"
import { tryReadLock } from "../core/x/read-lock"
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from "./command-io"
import { runCommand, signedInAccount } from "./commands.testing"
import { runRemoveCommand } from "./remove"

afterEach(removeTempDirs)

const STATE_DIR_FLAG = "--state-dir"
const MUST_NOT_ASK = async (): Promise<never> => {
  throw new Error("must not prompt")
}

const remove = runCommand.bind(null, runRemoveCommand)

async function labelsIn(stateDir: string): Promise<string[]> {
  return (await readdir(stateRoot(stateDir).accounts)).sort()
}

describe("remove confirmation", () => {
  test("--yes removes only the selected label without asking", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    await signedInAccount(stateDir, "other")

    const run = await remove(["--account=work", "--yes", `${STATE_DIR_FLAG}=${stateDir}`], {
      isTTY: false,
      readLine: MUST_NOT_ASK,
    })

    expect(run.code).toBe(EXIT_OK)
    expect(await labelsIn(stateDir)).toEqual(["other"])
    expect(run.stdout).toBe(
      'Removed "work": its local state is deleted. Cookies supplied through X_TOOLS_COOKIES_WORK are not removed.\n',
    )
  })

  test("a terminal confirms by typing the exact label, after being told what goes", async () => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")
    const prompts: string[] = []

    const run = await remove(["--account", "work", STATE_DIR_FLAG, stateDir], {
      isTTY: true,
      readLine: async (prompt) => {
        prompts.push(prompt)
        return "work"
      },
    })

    expect(run.code).toBe(EXIT_OK)
    expect(prompts).toEqual(['To confirm, type the label "work": '])
    expect(run.stderr).toContain(dir)
    expect(run.stderr).toContain("cookie file")
    expect(await labelsIn(stateDir)).toEqual([])
  })

  test.each(["other", " work ", "", undefined])("the answer %j cancels and keeps the state", async (answer) => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")

    const run = await remove(["--account", "work", STATE_DIR_FLAG, stateDir], {
      isTTY: true,
      readLine: async () => answer,
    })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stdout).toBe("")
    expect(run.stderr).toContain("Removal cancelled.")
    expect(await readdir(dir)).toContain("cookies")
  })

  test("without a terminal and without --yes it is a usage error and keeps the state", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const run = await remove(["--account", "work", STATE_DIR_FLAG, stateDir], { isTTY: false, readLine: MUST_NOT_ASK })

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stderr).toBe("x-tools-cli: Removing a reading account without a terminal requires --yes.\n")
    expect(await labelsIn(stateDir)).toEqual(["work"])
  })

  test("a label that is not there fails before anything is asked", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const run = await remove(["--account", "gone", STATE_DIR_FLAG, stateDir], { isTTY: true, readLine: MUST_NOT_ASK })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain('Reading account "gone" was not found')
    expect(await labelsIn(stateDir)).toEqual(["work"])
  })

  test.each(["before", "during"])("cancelling %s the confirmation keeps the state", async (when) => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")
    const controller = new AbortController()
    if (when === "before") controller.abort()

    const run = await remove(["--account", "work", STATE_DIR_FLAG, stateDir], {
      isTTY: true,
      signal: controller.signal,
      readLine: async () => {
        controller.abort()
        return "work"
      },
    })

    expect(run.code).toBe(EXIT_FAILED)
    expect(run.stderr).toContain("Cancelled.")
    expect(await labelsIn(stateDir)).toEqual(["work"])
  })
})

describe("remove refusals", () => {
  test("a read that holds the lock stops it and leaves the directory", async () => {
    const stateDir = await tempDir()
    const dir = await signedInAccount(stateDir, "work")
    const release = tryReadLock(join(dir, "read.lock"))!
    try {
      const run = await remove(["--account", "work", "--yes", STATE_DIR_FLAG, stateDir])

      expect(run.code).toBe(EXIT_FAILED)
      expect(run.stdout).toBe("")
      expect(run.stderr).toContain("A read of this reading account is still running")
      expect(await readdir(dir)).toContain("cookies")
    } finally {
      release()
    }
    expect(await labelsIn(stateDir)).toEqual(["work"])
  })

  test("a label directory that is a symlink is refused and its target is left alone", async () => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "other")
    const target = join(await tempDir(), "target")
    await mkdir(target)
    await writeFile(join(target, "keep"), "x")
    await symlink(target, join(stateRoot(stateDir).accounts, "work"))

    const run = await remove(["--account", "work", "--yes", STATE_DIR_FLAG, stateDir])

    expect(run.code).toBe(EXIT_FAILED)
    expect(await readdir(target)).toEqual(["keep"])
    expect(await labelsIn(stateDir)).toEqual(["other", "work"])
  })

  test.each(
    [
      [],
      ["--yes"],
      ["--account"],
      ["--account="],
      ["--account", "Bad"],
      ["--account", "work", "--yes=true"],
      ["--account", "work", "--nope"],
      ["--account", "work", "extra"],
    ].map((args): [string[]] => [args]),
  )("invalid arguments %j are a usage error with no effect", async (argv) => {
    const stateDir = await tempDir()
    await signedInAccount(stateDir, "work")

    const run = await remove([...argv, `${STATE_DIR_FLAG}=${stateDir}`], { isTTY: true, readLine: MUST_NOT_ASK })

    expect(run.code).toBe(EXIT_USAGE)
    expect(run.stdout).toBe("")
    expect(await labelsIn(stateDir)).toEqual(["work"])
  })
})
