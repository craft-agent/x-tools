import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { AUTH, COOKIES, CT0 } from "../x/cookies.testing"
import { cookieFingerprint } from "../x/cookies"
import { removeTempDirs, tempDir } from "../x/engine.testing"
import { fixture, readyFixture } from "./read.testing"

afterEach(removeTempDirs)

const VARIABLE = "X_TOOLS_COOKIES_DEFAULT"

/** The one account's row of a ready engine. */
async function row(h: Awaited<ReturnType<typeof readyFixture>>) {
  const { accounts } = await h.read()
  return accounts[0]!
}

/** Writes the cookie file with exactly `mode`, whatever the umask. */
async function writeCookies(path: string, text: string, mode = 0o600) {
  await writeFile(path, text)
  await chmod(path, mode)
}

describe("the cookies of an account", () => {
  test("a file is the source and its cookies are available", async () => {
    const h = await readyFixture()
    expect(await row(h)).toMatchObject({ cookie_source: "file", cookie_status: "available", health: "ready" })
  })

  test("the variable is the source and wins over a file that would be unusable", async () => {
    const h = await readyFixture()
    await writeCookies(h.paths.cookies, "garbage", 0o644)
    h.env[VARIABLE] = `  ${COOKIES}\n`
    expect(await row(h)).toMatchObject({ cookie_source: "variable", cookie_status: "available", health: "ready" })
  })

  test("a variable that is set but holds no pair is the source and is invalid, whatever the file holds", async () => {
    const h = await readyFixture()
    for (const value of ["", `auth_token=${AUTH}`]) {
      h.env[VARIABLE] = value
      expect(await row(h)).toMatchObject({
        cookie_source: "variable",
        cookie_status: "invalid",
        reasons: ["cookies_invalid"],
        action: "login",
      })
    }
  })

  test("the variable is named by the runtime's prefix and the label", async () => {
    const h = await readyFixture()
    await h.label("work_2", { cookies: COOKIES })
    h.runtime.envPrefix = "OTHER"
    h.env.OTHER_COOKIES_WORK_2 = "auth_token=x"
    h.env[VARIABLE] = "auth_token=x"
    const rows = Object.fromEntries((await h.read()).accounts.map((account) => [account.label, account]))
    expect(rows.default).toMatchObject({ cookie_source: "file", cookie_status: "available" })
    expect(rows.work_2).toMatchObject({ cookie_source: "variable", cookie_status: "invalid" })
  })

  test("no file and no variable is missing, with no source", async () => {
    const h = await fixture()
    await h.engine()
    await h.label("default")
    expect((await h.read()).accounts[0]).toMatchObject({
      cookie_source: null,
      cookie_status: "missing",
      reasons: ["cookies_missing"],
      action: "login",
      health: "attention",
    })
  })

  test("a file without both cookies, or an empty one, is invalid", async () => {
    const h = await readyFixture()
    for (const text of [`auth_token=${AUTH}\n`, `ct0=${CT0}`, "", "no cookies here"]) {
      await writeCookies(h.paths.cookies, text)
      expect(await row(h)).toMatchObject({ cookie_source: "file", cookie_status: "invalid", action: "login" })
    }
  })

  test("a file other users can read is unreadable", async () => {
    const h = await readyFixture()
    await writeCookies(h.paths.cookies, COOKIES, 0o644)
    expect(await row(h)).toMatchObject({
      cookie_source: "file",
      cookie_status: "unreadable",
      reasons: ["cookies_unreadable"],
      action: "login",
    })
  })

  test("a link or a directory in place of the file is unreadable", async () => {
    const h = await readyFixture()
    const target = join(await tempDir(), "real")
    await writeCookies(target, COOKIES)
    await rm(h.paths.cookies)
    await symlink(target, h.paths.cookies)
    expect(await row(h)).toMatchObject({ cookie_source: "file", cookie_status: "unreadable" })
    await rm(h.paths.cookies)
    await mkdir(h.paths.cookies)
    expect(await row(h)).toMatchObject({ cookie_source: "file", cookie_status: "unreadable" })
  })

  test("no result holds a cookie value, nor the fingerprint, whatever state the cookies are in", async () => {
    const h = await readyFixture()
    const texts: string[] = []
    const reading = async () => texts.push(JSON.stringify(await h.read()))
    await reading()
    h.env[VARIABLE] = COOKIES
    await reading()
    h.env[VARIABLE] = `auth_token=${AUTH}`
    await reading()
    delete h.env[VARIABLE]
    await writeCookies(h.paths.cookies, `auth_token=${AUTH}`)
    await reading()
    await writeCookies(h.paths.cookies, COOKIES, 0o644)
    await reading()
    expect(texts).toHaveLength(5)
    for (const text of texts) {
      for (const secret of [AUTH, CT0, COOKIES, cookieFingerprint(COOKIES)]) expect(text).not.toContain(secret)
    }
  })
})
