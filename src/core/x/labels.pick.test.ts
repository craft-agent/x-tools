import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "../errors"
import { pickLabel } from "./labels"

let state: string

beforeEach(() => {
  state = join(mkdtempSync(join(tmpdir(), "xpick-")), "state")
})

afterEach(() => {
  rmSync(join(state, ".."), { recursive: true, force: true })
})

function setUp(...labels: string[]): void {
  mkdirSync(state, { recursive: true })
  for (const label of labels) mkdirSync(join(state, "accounts", label), { recursive: true })
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return undefined
}

describe("pickLabel with an account", () => {
  test("returns the paths of an account that exists", async () => {
    setUp("work", "other")
    const paths = await pickLabel(state, "work")
    expect(paths).toEqual({
      label: "work",
      dir: join(state, "accounts", "work"),
      cookies: join(state, "accounts", "work", "cookies"),
      lock: join(state, "accounts", "work", "read.lock"),
      pacing: join(state, "accounts", "work", "pacing.json"),
    })
  })

  test("not_found names the label and the known accounts", async () => {
    setUp("personal", "alt")
    const error = await failure(() => pickLabel(state, "work"))
    expect(isToolError(error) && error.code).toBe("not_found")
    expect((error as Error).message).toBe('Reading account "work" was not found; known accounts: alt, personal.')
    expect(isToolError(error) && error.details).toEqual({ known_accounts: ["alt", "personal"] })
  })

  test("not_found says no reading account is set up when there is none", async () => {
    setUp()
    const error = await failure(() => pickLabel(state, "work"))
    expect(isToolError(error) && error.code).toBe("not_found")
    expect((error as Error).message).toBe('Reading account "work" was not found; no reading account is set up yet.')
  })

  test("a bad account name is invalid_argument", async () => {
    setUp("work")
    const error = await failure(() => pickLabel(state, "INVALID"))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
  })
})

describe("pickLabel without an account", () => {
  test("returns the only label", async () => {
    setUp("solo")
    expect((await pickLabel(state)).label).toBe("solo")
  })

  test("not_found when none is set up", async () => {
    setUp()
    const error = await failure(() => pickLabel(state))
    expect(isToolError(error) && error.code).toBe("not_found")
    expect((error as Error).message).toBe("No reading account is set up yet.")
  })

  test("invalid_argument listing the labels when several exist", async () => {
    setUp("beta", "alpha")
    const error = await failure(() => pickLabel(state))
    expect(isToolError(error) && error.code).toBe("invalid_argument")
    expect((error as Error).message).toBe("Several reading accounts are set up; name one with `account`: alpha, beta.")
    expect(isToolError(error) && error.details).toEqual({ known_accounts: ["alpha", "beta"] })
  })

  test("labels beside accounts/ do not count", async () => {
    setUp("solo")
    mkdirSync(join(state, "grants"))
    mkdirSync(join(state, "engine"))
    expect((await pickLabel(state)).label).toBe("solo")
  })
})
