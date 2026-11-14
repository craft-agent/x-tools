import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { removeTempDirs, tempDir } from "./engine.testing"
import { ensureLabelDir, labelPaths, type LabelPaths } from "./labels"
import { MAX_USER_IDS, USER_ID_TTL_MS, readUserId, writeUserId } from "./user-ids"

afterEach(removeTempDirs)

const NOW = Date.parse("2026-03-01T00:00:00Z")

async function labelWith(name = "default"): Promise<LabelPaths> {
  return ensureLabelDir(await tempDir(), name)
}

/** The handles the file holds. */
async function handlesOf(paths: LabelPaths): Promise<string[]> {
  return Object.keys(JSON.parse(await readFile(paths.userIds, "utf8")).ids)
}

describe("the handle → user id cache: what it remembers", () => {
  test("gives back what was written, for the handle in any case, and null for another", async () => {
    const paths = await labelWith()
    await writeUserId(paths, "Ada_Writes", "4001", NOW)
    expect(await readUserId(paths, "ada_writes", NOW)).toBe("4001")
    expect(await readUserId(paths, "ADA_WRITES", NOW)).toBe("4001")
    expect(await readUserId(paths, "grace", NOW)).toBeNull()
    expect(await handlesOf(paths)).toEqual(["ada_writes"])
  })

  test("writes the file as the documented shape, with mode 600, and leaves no temporary file", async () => {
    const paths = await labelWith()
    await writeUserId(paths, "ada", "4001", NOW)
    expect(JSON.parse(await readFile(paths.userIds, "utf8"))).toEqual({ v: 1, ids: { ada: { id: "4001", at: NOW } } })
    expect((await stat(paths.userIds)).mode & 0o777).toBe(0o600)
    expect(await readdir(paths.dir)).toEqual(["user-ids.json"])
  })

  test("a handle written again takes the new id and time, and keeps the others", async () => {
    const paths = await labelWith()
    await writeUserId(paths, "ada", "4001", NOW)
    await writeUserId(paths, "grace", "4002", NOW + 1)
    await writeUserId(paths, "ADA", "4003", NOW + 2)
    expect(await readUserId(paths, "ada", NOW + 2)).toBe("4003")
    expect(await readUserId(paths, "grace", NOW + 2)).toBe("4002")
    expect(await handlesOf(paths)).toHaveLength(2)
  })

  test("labels keep separate caches", async () => {
    const stateDir = await tempDir()
    const work = await ensureLabelDir(stateDir, "work")
    const other = await ensureLabelDir(stateDir, "other")
    await writeUserId(work, "ada", "4001", NOW)
    expect(await readUserId(other, "ada", NOW)).toBeNull()
    expect(labelPaths(stateDir, "work").userIds).toBe(work.userIds)
    expect(work.userIds).not.toBe(other.userIds)
  })
})

describe("the handle → user id cache: when an entry is fresh", () => {
  test("is fresh for 7 days and expired from the 7th day on", async () => {
    const paths = await labelWith()
    expect(USER_ID_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
    await writeUserId(paths, "ada", "4001", NOW)
    expect(await readUserId(paths, "ada", NOW + USER_ID_TTL_MS - 1)).toBe("4001")
    expect(await readUserId(paths, "ada", NOW + USER_ID_TTL_MS)).toBeNull()
  })

  test("an entry from the future, as a clock set back leaves one, is not trusted", async () => {
    const paths = await labelWith()
    await writeUserId(paths, "ada", "4001", NOW)
    expect(await readUserId(paths, "ada", NOW - 1)).toBeNull()
  })
})

describe("the handle → user id cache: its size", () => {
  test("keeps 200 entries, and the 201st drops the oldest", async () => {
    const paths = await labelWith()
    expect(MAX_USER_IDS).toBe(200)
    // Written newest first, so the order of writing is no clue to which is oldest.
    for (let index = MAX_USER_IDS - 1; index >= 0; index--) {
      await writeUserId(paths, `user${index}`, String(1000 + index), NOW + index)
    }
    expect(await handlesOf(paths)).toHaveLength(MAX_USER_IDS)
    expect(await readUserId(paths, "user0", NOW + MAX_USER_IDS)).toBe("1000")

    await writeUserId(paths, "newcomer", "5000", NOW + MAX_USER_IDS)
    const handles = await handlesOf(paths)
    expect(handles).toHaveLength(MAX_USER_IDS)
    expect(handles).toContain("newcomer")
    expect(handles).not.toContain("user0")
    expect(handles).toContain("user1")
  })

  test("a handle already there does not push another out", async () => {
    const paths = await labelWith()
    for (let index = 0; index < MAX_USER_IDS; index++) {
      await writeUserId(paths, `user${index}`, String(1000 + index), NOW + index)
    }
    await writeUserId(paths, "user5", "9999", NOW + MAX_USER_IDS)
    const handles = await handlesOf(paths)
    expect(handles).toHaveLength(MAX_USER_IDS)
    expect(handles).toContain("user0")
    expect(await readUserId(paths, "user5", NOW + MAX_USER_IDS)).toBe("9999")
  })

  test("the entry just written stays even when it is older than all the others", async () => {
    const paths = await labelWith()
    for (let index = 0; index < MAX_USER_IDS; index++) {
      await writeUserId(paths, `user${index}`, String(1000 + index), NOW + 1000 + index)
    }
    await writeUserId(paths, "newcomer", "5000", NOW)
    expect(await handlesOf(paths)).toContain("newcomer")
  })
})

describe("the handle → user id cache: a file that is no cache, and a write that fails", () => {
  test("a missing, unreadable or malformed file reads as empty, and the next write replaces it", async () => {
    const paths = await labelWith()
    expect(await readUserId(paths, "ada", NOW)).toBeNull()
    const bad = [
      "{not json",
      "[]",
      "null",
      JSON.stringify({ v: 2, ids: { ada: { id: "4001", at: NOW } } }),
      JSON.stringify({ v: 1 }),
      JSON.stringify({ v: 1, ids: { ada: { id: "not digits", at: NOW } } }),
      JSON.stringify({ v: 1, ids: { ada: { id: "4001", at: "now" } } }),
    ]
    for (const text of bad) {
      await writeFile(paths.userIds, text)
      expect(await readUserId(paths, "ada", NOW)).toBeNull()
    }
    await writeUserId(paths, "grace", "4002", NOW)
    expect(await handlesOf(paths)).toEqual(["grace"])
  })

  test("a directory where the file belongs reads as empty", async () => {
    const paths = await labelWith()
    await mkdir(paths.userIds)
    expect(await readUserId(paths, "ada", NOW)).toBeNull()
  })

  test("a write that fails is ignored", async () => {
    const paths = await labelWith()
    await mkdir(paths.userIds)
    await writeUserId(paths, "ada", "4001", NOW)
    const gone = { ...paths, userIds: `${paths.dir}/missing-dir/user-ids.json` }
    await writeUserId(gone, "ada", "4001", NOW)
    expect(await readdir(paths.dir)).toEqual(["user-ids.json"])
  })
})
