import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, readdir, symlink } from "node:fs/promises"
import { join } from "node:path"
import { ToolError } from "../errors"
import { routeGone } from "../posts/view.testing"
import { file, late, rejected, reply, waitUntil } from "./media.testing"
import { saveMedia } from "./save"
import {
  fxPhoto,
  fxStatus,
  fxVideo,
  photoUrl,
  routePost,
  saveFixture,
  videoUrl,
  type SaveFixture,
} from "./save.testing"

let s: SaveFixture

beforeEach(async () => {
  s = await saveFixture()
})

afterEach(() => s.dispose())

const photos = (...names: string[]) => ({ all: names.map((name) => fxPhoto({ url: photoUrl(name) })) })
const photoRoute = (name: string) => `/media/${name}.jpg?name=orig`

describe("x_media_download: failures of single files", () => {
  test("lists a file that failed and saves the rest", async () => {
    routePost(s.h, "20", "ada_writes", { media: photos("a", "b") })
    s.cdn.route(photoRoute("a"), reply(404, {}))
    s.cdn.route(photoRoute("b"), file("image/jpeg", "fine"))

    const result = await s.save({ post: "20" })

    expect(result.files).toEqual([expect.objectContaining({ path: join(s.cdn.dir, "20", "20-2.jpg") })])
    expect(result.failed).toEqual([
      { from: "20", kind: "photo", error: expect.stringMatching(/^upstream_error: .*server did not answer/) },
    ])
  })

  test("a video or GIF with no MP4 is listed as failed, and is the failure thrown when nothing else was saved", async () => {
    const formats = [{ container: "m3u8", url: videoUrl("pl"), bitrate: 1 }]
    const noMp4 = fxVideo("video", { url: videoUrl("own").replace(".mp4", ".m3u8"), formats })
    routePost(s.h, "20", "ada_writes", { media: { all: [noMp4, fxPhoto({ url: photoUrl("a") })] } })
    s.cdn.route(photoRoute("a"), file("image/jpeg", "fine"))
    const result = await s.save({ post: "20" })
    expect(result.files).toHaveLength(1)
    expect(result.failed).toEqual([
      { from: "20", kind: "video", error: expect.stringMatching(/^upstream_error: .*no MP4/) },
    ])

    routePost(s.h, "21", "ada_writes", { media: { all: [noMp4] } })
    expect(await rejected(s.save({ post: "21" }))).toMatchObject({
      code: "upstream_error",
      message: expect.stringContaining("no MP4"),
    })
    expect(await readdir(s.cdn.dir)).toEqual(["20"])
  })

  test("throws the first failure as it was when nothing was saved, and leaves no folder it made", async () => {
    routePost(s.h, "20", "ada_writes", { media: photos("a", "b") })
    s.cdn.route(photoRoute("a"), file("text/html", "<p>no</p>"))
    s.cdn.route(photoRoute("b"), reply(500, {}))

    const error = await rejected(s.save({ post: "20" }))

    expect(error).toBeInstanceOf(ToolError)
    expect(error).toMatchObject({ code: "upstream_error", details: { source: "cdn", reason: "type" } })
    expect(s.cdn.requests).toHaveLength(2)
    expect(await readdir(s.cdn.dir)).toEqual([])
  })

  test("rethrows what is not a tool failure and cleans up", async () => {
    routePost(s.h, "20", "ada_writes", { media: photos("a") })
    const connect = () => {
      throw new TypeError("a bug")
    }
    const error = await rejected(saveMedia({ post: "20" }, s.context(), s.h.reader(), { connect }))
    expect(error).toBeInstanceOf(TypeError)
    expect(await readdir(s.cdn.dir)).toEqual([])
  })

  test("rethrows an abort at once, with nothing left behind", async () => {
    routePost(s.h, "20", "ada_writes", { media: photos("a", "b") })
    s.cdn.route(photoRoute("a"), late(10_000, file("image/jpeg", "never")))
    const controller = new AbortController()

    const pending = rejected(s.save({ post: "20" }, { signal: controller.signal }))
    await waitUntil(() => s.cdn.requests.length > 0)
    controller.abort()

    expect(await pending).toMatchObject({ name: "AbortError" })
    expect(s.cdn.requests).toHaveLength(1)
    expect(await readdir(s.cdn.dir)).toEqual([])
  })
})

describe("x_media_download: posts with nothing to save", () => {
  test("a post with no media is not_found, hinting at the quote's media only when they were not asked for", async () => {
    const quote = fxStatus({ id: "21", media: photos("q") })
    routePost(s.h, "20", "ada_writes", { quote })
    expect(await rejected(s.save({ post: "20" }))).toMatchObject({
      code: "not_found",
      message: "The post has no photo, video or GIF to save. The post it quotes has some: pass quoted: true.",
    })

    s.cdn.route(photoRoute("q"), file("image/jpeg", "quote"))
    expect((await s.save({ post: "20", quoted: true })).files.map(({ from }) => from)).toEqual(["21"])

    routePost(s.h, "22", "ada_writes", { quote: fxStatus({ id: "23" }) })
    for (const quoted of [false, true]) {
      expect(await rejected(s.save({ post: "22", quoted }))).toMatchObject({
        code: "not_found",
        message: "The post has no photo, video or GIF to save.",
      })
    }
    expect(await readdir(s.cdn.dir)).toEqual(["20"])
  })

  test("a post that is gone is not_found with the source's reason, and a folder that was there is left", async () => {
    routeGone(s.h, "20", "deleted")
    await mkdir(join(s.cdn.dir, "20"))
    const error = await rejected(s.save({ post: "20" }))
    expect(error).toMatchObject({
      code: "not_found",
      details: { source: "fxtwitter", status: "not_found", reason: "deleted" },
    })
    expect((error as Error).message).toContain("not available")
    expect(await readdir(s.cdn.dir)).toEqual(["20"])

    routeGone(s.h, "21", "suspended")
    await rejected(s.save({ post: "21" }))
    expect(await readdir(s.cdn.dir)).toEqual(["20"])
    expect(s.cdn.requests).toEqual([])
  })
})

describe("x_media_download: refusals", () => {
  test("a post folder that is a link is forbidden, and nothing is read or written through it", async () => {
    const elsewhere = join(s.cdn.dir, "elsewhere")
    await mkdir(elsewhere)
    await symlink(elsewhere, join(s.cdn.dir, "20"))

    const error = await rejected(s.save({ post: "20" }))

    expect(error).toMatchObject({ code: "forbidden" })
    expect((error as Error).message).not.toContain(s.cdn.dir)
    expect(await readdir(elsewhere)).toEqual([])
    expect(s.h.fake.requests).toEqual([])
  })

  test("a download directory that turns out to be the state or install directory is forbidden, with no folder made", async () => {
    for (const context of [{ stateDir: s.cdn.dir }, { ownDir: s.cdn.dir }]) {
      expect(await rejected(s.save({ post: "20" }, { context }))).toMatchObject({ code: "forbidden" })
    }
    expect(await readdir(s.cdn.dir)).toEqual([])
    expect(s.h.fake.requests).toEqual([])
  })

  test("source fxtwitter under account_only is refused before anything is read, and leaves no folder", async () => {
    const error = await rejected(s.save({ post: "20", source: "fxtwitter" }, { options: { account_only: true } }))
    expect(error).toMatchObject({ code: "invalid_argument", message: expect.stringContaining("account_only") })
    expect(s.h.fake.requests).toEqual([])
    expect(await readdir(s.cdn.dir)).toEqual([])
  })

  test("a reference that names no post is invalid_argument", async () => {
    expect(await rejected(s.save({ post: "twenty" }))).toMatchObject({ code: "invalid_argument" })
    expect(await readdir(s.cdn.dir)).toEqual([])
  })
})
