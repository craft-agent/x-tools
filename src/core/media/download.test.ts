import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PROJECT } from "../../project"
import { ALL_TOOLS } from "../../tools"
import { annotations } from "../tool"
import type { ToolContext } from "../tool"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { rejected } from "./media.testing"
import { xMediaDownload } from "./download"
import { MEDIA_HEADLINE, MEDIA_HEADLINE_QUOTED, MEDIA_INTENT, MEDIA_TITLE } from "./words"

let root: string
let stateDir: string
let ownDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "x-tools-download-"))
  stateDir = join(root, "state")
  ownDir = join(root, "own")
  await mkdir(join(stateDir, "accounts"), { recursive: true })
  await mkdir(join(ownDir, "engine"), { recursive: true })
})

afterEach(() => rm(root, { recursive: true, force: true }))

const ctx = (downloadDir: string | undefined, extra: Partial<ToolContext> = {}): ToolContext => ({
  cwd: root,
  downloadDir,
  stateDir,
  ownDir,
  ...extra,
})
const gate = (post: string, context: ToolContext) =>
  rejected(Promise.resolve().then(() => xMediaDownload.gate!({ post }, context)))

describe("x_media_download: the spec", () => {
  test("is an add tool of the media toolset, on by default, with its own words", () => {
    expect(ALL_TOOLS).toContain(xMediaDownload)
    expect(xMediaDownload).toMatchObject({ id: "x_media_download", toolset: "media", class: "add" })
    expect([xMediaDownload.title, xMediaDownload.intent]).toEqual([MEDIA_TITLE, MEDIA_INTENT])
    expect(PROJECT.toolsets).toContain("media")
    expect(PROJECT.defaultToolsets).toContain("media")
    expect(annotations(xMediaDownload)).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(xMediaDownload.description.length).toBeLessThan(2000)
  })
})

describe("x_media_download: gate", () => {
  test("refuses a reference that names no post, saying so without echoing it", async () => {
    const error = await gate("https://example.com/not-a-post", ctx(join(root, "downloads")))
    expect(error).toMatchObject({ code: "invalid_argument" })
    expect((error as Error).message).not.toContain("example.com")
  })

  test("refuses a call without an absolute download directory as internal_error", async () => {
    expect(await gate("20", ctx(undefined))).toMatchObject({ code: "internal_error" })
    expect(await gate("20", ctx("downloads"))).toMatchObject({ code: "internal_error" })
  })

  test("refuses a download directory that is, or is inside, the state or install directory, naming no path", async () => {
    for (const downloadDir of [stateDir, join(stateDir, "accounts"), join(stateDir, "new", "deeper"), ownDir]) {
      const error = await gate("20", ctx(downloadDir))
      expect(error).toMatchObject({ code: "forbidden" })
      expect((error as Error).message).toContain("download_dir")
      expect((error as Error).message).not.toContain(root)
    }
  })

  test("judges by real path, through a link in the part that exists", async () => {
    await symlink(stateDir, join(root, "link"))
    expect(await gate("20", ctx(join(root, "link", "media")))).toMatchObject({ code: "forbidden" })
    await symlink(join(root, "link"), join(root, "link-of-link"))
    expect(await gate("20", ctx(join(root, "link-of-link")))).toMatchObject({ code: "forbidden" })
  })

  test("allows a directory that does not exist yet under a safe parent, with or without a state directory", async () => {
    const downloadDir = join(root, "elsewhere", "not", "yet")
    expect(await gate("20", ctx(downloadDir))).toBeUndefined()
    expect(await gate("20", ctx(downloadDir, { stateDir: undefined, ownDir: undefined }))).toBeUndefined()
    expect(await gate("https://x.com/ada/status/20", ctx(join(root, "state-2")))).toBeUndefined()
  })
})

describe("x_media_download: targets and describe", () => {
  let h: SourcesFixture

  beforeEach(async () => {
    h = await sourcesFixture()
  })

  afterEach(async () => {
    await h.dispose()
    await removeTempDirs()
  })

  test("the target is the post's folder, from the id a URL names", async () => {
    const downloadDir = join(root, "downloads")
    expect(await xMediaDownload.targets!({ post: "20" }, ctx(downloadDir))).toEqual([join(downloadDir, "20")])
    expect(await xMediaDownload.targets!({ post: " https://x.com/ada/status/21?s=1 " }, ctx(downloadDir))).toEqual([
      join(downloadDir, "21"),
    ])
  })

  test("describes the call from its arguments alone, with no facts and no text, reading nothing", async () => {
    const context = h.context()
    expect(await xMediaDownload.describe!({ post: "https://x.com/ada/status/20" }, context)).toEqual({
      headline: { text: MEDIA_HEADLINE, values: { post: "20" } },
      facts: [],
    })
    expect(await xMediaDownload.describe!({ post: "20", quoted: true }, context)).toEqual({
      headline: { text: MEDIA_HEADLINE_QUOTED, values: { post: "20" } },
      facts: [],
    })
    expect(MEDIA_HEADLINE).toBe("About to save the media of post {post}")
    expect(MEDIA_HEADLINE_QUOTED).toBe("About to save the media of post {post} and of the post it quotes")
    expect(h.fake.requests).toEqual([])
    expect(h.accountReads).toEqual([])
  })
})
