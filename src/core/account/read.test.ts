import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { annotations, invoke, selectTools } from "../tool"
import { PYTHON_VERSION, TWSCRAPE_VERSION } from "../x/engine"
import { removeTempDirs } from "../x/engine.testing"
import { COOKIES } from "../x/cookies.testing"
import { xAccountRead } from "./read"
import { fixture, readyFixture } from "./read.testing"

afterEach(removeTempDirs)

const INSTALL = (stateDir: string) =>
  `'/opt/x'\\''s cli' engine install --state-dir '${stateDir.replaceAll("'", "'\\''")}'`

describe("x_account_read", () => {
  test("is a read tool of the account toolset that stays on in read-only mode", () => {
    expect(xAccountRead.toolset).toBe("account")
    expect(annotations(xAccountRead)).toMatchObject({ readOnlyHint: true, idempotentHint: true })
    const toolsets = { names: ["account"], defaults: ["account"] }
    expect(selectTools([xAccountRead], { read_only: true }, toolsets)).toEqual([xAccountRead])
  })

  test("without a label reports no account, not an error, and the engine that is missing", async () => {
    const h = await fixture()
    expect(await h.read()).toEqual({
      engine: {
        status: "missing",
        python_version: null,
        twscrape_version: null,
        pinned_python: PYTHON_VERSION,
        pinned_twscrape: TWSCRAPE_VERSION,
        recovery_command: INSTALL(h.stateDir),
      },
      accounts: [],
    })
    await expect(stat(h.stateDir)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("a label with cookies in a file, an engine that is ready and no reads is ready", async () => {
    const h = await readyFixture()
    expect(await h.read()).toEqual({
      engine: {
        status: "ready",
        python_version: PYTHON_VERSION,
        twscrape_version: TWSCRAPE_VERSION,
        pinned_python: PYTHON_VERSION,
        pinned_twscrape: TWSCRAPE_VERSION,
        recovery_command: null,
      },
      accounts: [
        {
          label: "default",
          cookie_source: "file",
          cookie_status: "available",
          refused_at: null,
          refused_error: null,
          rate_limited_until: null,
          reads_last_hour: 0,
          reads_last_day: 0,
          reads_per_hour: 30,
          reads_per_day: 200,
          health: "ready",
          reasons: [],
          action: null,
          hint: null,
          recovery_command: null,
        },
      ],
    })
  })

  test("lists every label sorted and skips what is not a label; an explicit label reports that one", async () => {
    const h = await readyFixture()
    await h.label("zeta", { cookies: COOKIES })
    await h.label("alpha")
    await mkdir(join(h.stateDir, "accounts", "Bad-Label"))
    await writeFile(join(h.stateDir, "accounts", "file"), "")
    await symlink(h.paths.dir, join(h.stateDir, "accounts", "link"))
    expect((await h.read()).accounts.map((row) => row.label)).toEqual(["alpha", "default", "zeta"])
    expect((await h.read({ account: "zeta" })).accounts.map((row) => row.label)).toEqual(["zeta"])
  })

  test("an unknown label is not_found, a bad one and an unknown argument are invalid_argument", async () => {
    const h = await readyFixture()
    await expect(h.read({ account: "absent" })).rejects.toMatchObject({
      code: "not_found",
      details: { known_accounts: ["default"] },
    })
    await expect(h.read({ account: "../bad" })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(h.read({ unexpected: true })).rejects.toMatchObject({ code: "invalid_argument" })
  })

  test("an explicit label with no account at all is not_found", async () => {
    const h = await fixture()
    await expect(h.read({ account: "default" })).rejects.toMatchObject({ code: "not_found" })
  })

  test("needs a runtime and an absolute state directory", async () => {
    const h = await readyFixture()
    const message = "Account reads require a runtime and an absolute state directory."
    await expect(invoke(xAccountRead, {}, { cwd: "/" })).rejects.toMatchObject({ code: "internal_error", message })
    await expect(invoke(xAccountRead, {}, { ...h.ctx, runtime: undefined })).rejects.toMatchObject({
      code: "internal_error",
      message,
    })
    await expect(invoke(xAccountRead, {}, { ...h.ctx, stateDir: undefined })).rejects.toMatchObject({
      code: "internal_error",
      message,
    })
    await expect(invoke(xAccountRead, {}, { ...h.ctx, stateDir: "relative" })).rejects.toMatchObject({
      code: "internal_error",
      message,
    })
  })

  test("a cancelled call fails as cancelled", async () => {
    const h = await readyFixture()
    const controller = new AbortController()
    controller.abort()
    await expect(invoke(xAccountRead, {}, { ...h.ctx, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    })
  })

  test("names the runtime's command line in the commands it gives", async () => {
    const h = await fixture()
    await h.engine()
    await h.label("default")
    const {
      accounts: [row],
    } = await h.read()
    expect(row!.recovery_command).toBe(
      `'/opt/x'\\''s cli' login --account 'default' --state-dir '${h.stateDir.replaceAll("'", "'\\''")}'`,
    )
  })
})
