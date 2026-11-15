import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { MediaKind } from "./cdn"
import { PHOTO_URL, VIDEO_URL, chunked, file, startMediaFixture, type MediaFixture } from "./media.testing"

let fake: MediaFixture

beforeEach(async () => {
  fake = await startMediaFixture()
})

afterEach(async () => {
  await fake.stop()
})

const PHOTO_PATH = "/media/AbC.jpg?name=orig"
const VIDEO_PATH = "/ext_tw_video/1/vid/clip.mp4"
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0xfe, 0x80])

describe("downloadMedia success", () => {
  test("writes the bytes exactly, with mode 0644 and no part file left", async () => {
    fake.route(PHOTO_PATH, file("image/jpeg", BYTES))
    const result = await fake.download(PHOTO_URL)
    expect(result).toEqual({
      path: join(fake.dir, "123-1.jpg"),
      bytes: BYTES.length,
      mime: "image/jpeg",
      reused: false,
    })
    expect(await readFile(result.path)).toEqual(BYTES)
    expect((await lstat(result.path)).mode & 0o777).toBe(0o644 & ~process.umask())
    expect(await fake.listing()).toEqual(["123-1.jpg"])
  })

  test("sends a User-Agent and nothing else of its own: no cookie, credential, referer or encoding", async () => {
    fake.route(PHOTO_PATH, file("image/jpeg", BYTES))
    await fake.download(PHOTO_URL)
    expect(fake.requests).toHaveLength(1)
    const [request] = fake.requests
    expect(request?.method).toBe("GET")
    expect(Object.keys(request!.headers).sort()).toEqual(["connection", "host", "user-agent"])
    expect(request?.headers["user-agent"]).toBe("test-client/1")
  })

  test.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["IMAGE/PNG; charset=binary", "png"],
  ])("a photo served as %s is kept as .%s, whatever its URL says", async (type, extension) => {
    fake.route(PHOTO_PATH, file(type, BYTES))
    const result = await fake.download(PHOTO_URL)
    expect(result.path).toBe(join(fake.dir, `123-1.${extension}`))
    expect(result.mime).toBe(type.split(";")[0]!.toLowerCase())
  })

  test.each<MediaKind>(["video", "gif"])("a %s served as video/mp4 is kept as .mp4", async (kind) => {
    fake.route(VIDEO_PATH, file("video/mp4", BYTES))
    const result = await fake.download(VIDEO_URL, kind)
    expect(result).toEqual({ path: join(fake.dir, "123-1.mp4"), bytes: BYTES.length, mime: "video/mp4", reused: false })
  })

  test("takes a body with no length announced, and a body larger than one chunk", async () => {
    const chunks = [Buffer.alloc(64 * 1024, 1), Buffer.alloc(64 * 1024, 2), Buffer.alloc(10, 3)]
    fake.route(PHOTO_PATH, chunked("image/png", chunks, 1))
    const result = await fake.download(PHOTO_URL)
    expect(await readFile(result.path)).toEqual(Buffer.concat(chunks))
  })

  test("takes a file of exactly the cap", async () => {
    fake.route(PHOTO_PATH, file("image/jpeg", BYTES))
    expect((await fake.download(PHOTO_URL, "photo", { maxBytes: BYTES.length })).bytes).toBe(BYTES.length)
  })

  test("a body of several megabytes arrives whole", async () => {
    const body = Buffer.alloc(8 * 1024 * 1024, 7)
    fake.route(PHOTO_PATH, file("image/jpeg", body))
    const result = await fake.download(PHOTO_URL)
    expect(result.bytes).toBe(body.length)
    expect((await readFile(result.path)).equals(body)).toBe(true)
  })
})

describe("downloadMedia reuse and existing files", () => {
  test("a non-empty file of the stem is reused without a request, under any extension of the kind", async () => {
    await writeFile(join(fake.dir, "123-1.webp"), "old")
    expect(await fake.download(PHOTO_URL)).toEqual({
      path: join(fake.dir, "123-1.webp"),
      bytes: 3,
      mime: null,
      reused: true,
    })
    expect(fake.requests).toEqual([])
  })

  test("a file of another kind's extension, or another stem, is not reused", async () => {
    await writeFile(join(fake.dir, "123-1.mp4"), "old")
    await writeFile(join(fake.dir, "123-2.jpg"), "old")
    fake.route(PHOTO_PATH, file("image/jpeg", BYTES))
    expect((await fake.download(PHOTO_URL)).reused).toBe(false)
    expect(await readFile(join(fake.dir, "123-1.mp4"), "utf8")).toBe("old")
  })

  test("a directory or a symlink at the final name is not reused", async () => {
    await mkdir(join(fake.dir, "123-1.png"))
    await writeFile(join(fake.dir, "target"), "secret")
    await symlink(join(fake.dir, "target"), join(fake.dir, "123-1.jpg"))
    fake.route(PHOTO_PATH, file("image/webp", BYTES))
    const result = await fake.download(PHOTO_URL)
    expect(result).toMatchObject({ path: join(fake.dir, "123-1.webp"), reused: false })
    expect(fake.requests).toHaveLength(1)
  })
})
