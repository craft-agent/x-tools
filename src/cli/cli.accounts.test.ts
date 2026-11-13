import { afterEach, describe, expect, test } from "bun:test"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { COOKIES } from "../core/x/cookies.testing"
import { labelPaths } from "../core/x/labels"
import { removeTempDirs, tempDir } from "../core/x/engine.testing"
import { EXIT_OK } from "./command-io"
import { cli } from "./testing"

afterEach(removeTempDirs)

describe("the command line's account commands", () => {
  test("login stores the cookies from standard input and remove deletes the account", async () => {
    const stateDir = await tempDir()

    const login = await cli(["login", "--account", "work", "--state-dir", stateDir], COOKIES)
    expect(login.code).toBe(EXIT_OK)
    expect(await readFile(labelPaths(stateDir, "work").cookies, "utf8")).toBe(`${COOKIES}\n`)

    const remove = await cli(["remove", "--account", "work", "--yes", "--state-dir", stateDir])
    expect(remove.code).toBe(EXIT_OK)
    expect(await readdir(join(stateDir, "accounts"))).toEqual([])
  })
})
