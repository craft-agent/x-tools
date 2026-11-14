import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cookieVariable, readCookies } from "./cookies"
import { AUTH, COOKIES, failureOf } from "./cookies.testing"
import { removeTempDirs, tempDir } from "./engine.testing"
import { ensureLabelDir, labelPaths } from "./labels"

afterEach(removeTempDirs)

const VARIABLE = "X_TOOLS_COOKIES_DEFAULT"

async function setup() {
  const stateDir = await tempDir()
  const paths = await ensureLabelDir(stateDir, "default")
  return { stateDir, paths }
}

describe("cookieVariable", () => {
  test("is the prefix, COOKIES and the upper-cased label", () => {
    expect(cookieVariable("X_TOOLS", "default")).toBe(VARIABLE)
    expect(cookieVariable("X_TOOLS", "my_acct1")).toBe("X_TOOLS_COOKIES_MY_ACCT1")
  })
})

describe("readCookies from the variable", () => {
  test("is read trimmed, and wins over a file that would fail", async () => {
    const { paths } = await setup()
    await writeFile(paths.cookies, "garbage", { mode: 0o644 })
    const cookies = await readCookies({ paths, variable: VARIABLE, env: { [VARIABLE]: `  ${COOKIES}\n` } })
    expect(cookies).toEqual({ source: "variable", value: COOKIES })
  })

  test("a variable that is set but empty is unauthenticated, and the file is not read", async () => {
    const { paths } = await setup()
    await writeFile(paths.cookies, COOKIES, { mode: 0o600 })
    const error = await failureOf(readCookies({ paths, variable: VARIABLE, env: { [VARIABLE]: "" } }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe(`\`${VARIABLE}\` does not hold both auth_token and ct0.`)
  })

  test("a variable without the pair is unauthenticated and its message never holds the value", async () => {
    const { paths } = await setup()
    const error = await failureOf(readCookies({ paths, variable: VARIABLE, env: { [VARIABLE]: `auth_token=${AUTH}` } }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).not.toContain(AUTH)
  })
})

describe("readCookies from the file", () => {
  test("is read trimmed", async () => {
    const { paths } = await setup()
    await writeFile(paths.cookies, `${COOKIES}\n`, { mode: 0o600 })
    expect(await readCookies({ paths, variable: VARIABLE, env: {} })).toEqual({ source: "file", value: COOKIES })
  })

  test("a missing file is unauthenticated, naming the account and the variable", async () => {
    const { paths } = await setup()
    const error = await failureOf(readCookies({ paths, variable: VARIABLE, env: {} }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe(`No cookies for reading account "default": set ${VARIABLE} or sign in with login.`)
    expect(error.details).toEqual({ account: "default", variable: VARIABLE })
  })

  test("a label directory that is not there is the same as a missing file", async () => {
    const stateDir = await tempDir()
    const error = await failureOf(readCookies({ paths: labelPaths(stateDir, "other"), variable: VARIABLE, env: {} }))
    expect(error.code).toBe("unauthenticated")
  })

  test("a symlink is forbidden, even to a good file", async () => {
    const { paths } = await setup()
    const target = join(await tempDir(), "real")
    await writeFile(target, COOKIES, { mode: 0o600 })
    await symlink(target, paths.cookies)
    const error = await failureOf(readCookies({ paths, variable: VARIABLE, env: {} }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toContain("link or not a regular file")
  })

  test("a directory is forbidden", async () => {
    const { paths } = await setup()
    await mkdir(paths.cookies)
    expect((await failureOf(readCookies({ paths, variable: VARIABLE, env: {} }))).code).toBe("forbidden")
  })

  test("a file readable by group or others is forbidden with the chmod to run, and is not read", async () => {
    const { paths } = await setup()
    await writeFile(paths.cookies, COOKIES)
    await chmod(paths.cookies, 0o644)
    const error = await failureOf(readCookies({ paths, variable: VARIABLE, env: {} }))
    expect(error.code).toBe("forbidden")
    expect(error.message).toBe(
      `The cookie file ${paths.cookies} is readable by other users; run chmod 600 ${JSON.stringify(paths.cookies)}.`,
    )
    expect(error.message).not.toContain(AUTH)
  })

  test("a file without the pair is unauthenticated, naming the file and never the value", async () => {
    const { paths } = await setup()
    await writeFile(paths.cookies, `auth_token=${AUTH}\n`, { mode: 0o600 })
    const error = await failureOf(readCookies({ paths, variable: VARIABLE, env: {} }))
    expect(error.code).toBe("unauthenticated")
    expect(error.message).toBe(`The cookie file ${paths.cookies} does not hold both auth_token and ct0.`)
    expect(error.message).not.toContain(AUTH)
  })

  test("an empty file is unauthenticated", async () => {
    const { paths } = await setup()
    await writeFile(paths.cookies, "", { mode: 0o600 })
    expect((await failureOf(readCookies({ paths, variable: VARIABLE, env: {} }))).code).toBe("unauthenticated")
  })
})
