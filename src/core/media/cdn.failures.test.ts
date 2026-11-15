import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isAbortError, isToolError } from "../errors"
import { downloadMedia, type MediaFailureReason, type MediaKind } from "./cdn"
import {
  PHOTO_URL,
  TEST_USER_AGENT,
  VIDEO_URL,
  chunked,
  cutShort,
  file,
  late,
  rejected,
  reply,
  startMediaFixture,
  waitUntil,
  type MediaFixture,
} from "./media.testing"

let fake: MediaFixture

beforeEach(async () => {
  fake = await startMediaFixture()
})

afterEach(async () => {
  await fake.stop()
})

const PHOTO_PATH = "/media/AbC.jpg?name=orig"
const VIDEO_PATH = "/ext_tw_video/1/vid/clip.mp4"
const CAP = 2_500

/** Expects the download to fail with `reason` and to leave nothing in the directory. */
async function expectFailure(promise: Promise<unknown>, reason: MediaFailureReason, status?: number): Promise<void> {
  expect(await fake.detailsOf(promise)).toEqual({ source: "cdn", reason, ...(status ? { status } : {}) })
  expect(await fake.listing()).toEqual([])
}

describe("downloadMedia refusals", () => {
  test.each<[string, MediaKind, string, string | undefined]>([
    ["a video type for a photo", "photo", PHOTO_PATH, "video/mp4"],
    ["an image type for a video", "video", VIDEO_PATH, "image/jpeg"],
    ["an image type for a gif", "gif", VIDEO_PATH, "image/gif"],
    ["a type no kind accepts", "photo", PHOTO_PATH, "text/html; charset=utf-8"],
    ["a missing type", "photo", PHOTO_PATH, undefined],
  ])("refuses %s and writes nothing", async (_name, kind, path, type) => {
    fake.route(path, file(type, "bytes"))
    const url = kind === "photo" ? PHOTO_URL : VIDEO_URL
    await expectFailure(fake.download(url, kind), "type")
  })

  test.each([404, 403, 500, 206])("refuses status %d", async (status) => {
    fake.route(PHOTO_PATH, reply(status, { "Content-Type": "image/jpeg" }, "bytes"))
    await expectFailure(fake.download(PHOTO_URL), "status", status)
  })

  test("refuses a content length over the cap before reading the body", async () => {
    fake.route(PHOTO_PATH, (response) => {
      response.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": String(CAP + 1) })
      response.flushHeaders()
    })
    await expectFailure(fake.download(PHOTO_URL, "photo", { maxBytes: CAP }), "too_large")
  })

  test("refuses a body that grows past the cap while it arrives", async () => {
    const chunks = Array.from({ length: 6 }, () => Buffer.alloc(1_000, 1))
    fake.route(PHOTO_PATH, chunked("image/jpeg", chunks, 20))
    await expectFailure(fake.download(PHOTO_URL, "photo", { maxBytes: CAP }), "too_large")
    await waitUntil(() => fake.cutOff() > 0)
    expect(fake.cutOff()).toBe(1)
  })

  test("refuses a body shorter than its content length", async () => {
    fake.route(PHOTO_PATH, cutShort("image/jpeg", 100, "abc"))
    await expectFailure(fake.download(PHOTO_URL), "short")
  })

  test.each([
    ["announced as empty", file("image/jpeg", "")],
    ["with no length", chunked("image/jpeg", [], 0)],
  ])("refuses an empty body %s", async (_name, handler) => {
    fake.route(PHOTO_PATH, handler)
    await expectFailure(fake.download(PHOTO_URL), "empty")
  })

  test("a connection cut before any reply is a network failure", async () => {
    fake.route(PHOTO_PATH, (response) => response.destroy())
    await expectFailure(fake.download(PHOTO_URL), "network")
  })

  test("a body cut with no length announced is a network failure", async () => {
    fake.route(PHOTO_PATH, (response) => {
      response.writeHead(200, { "Content-Type": "image/jpeg" })
      response.write("abc", () => response.destroy())
    })
    await expectFailure(fake.download(PHOTO_URL), "network")
  })

  test("a directory that is gone is an internal error, not an upstream one", async () => {
    fake.route(PHOTO_PATH, file("image/jpeg", "bytes"))
    const error = await rejected(
      downloadMedia(PHOTO_URL, "photo", join(fake.dir, "missing"), "123-1", {
        userAgent: TEST_USER_AGENT,
        connect: fake.connect,
      }),
    )
    expect(isToolError(error) && error.code).toBe("internal_error")
    expect(isToolError(error) && error.message).not.toContain(fake.dir)
  })
})

describe("downloadMedia time limits and aborts", () => {
  test("a download past the time limit is a timeout", async () => {
    const chunks = Array.from({ length: 40 }, () => Buffer.alloc(100, 1))
    fake.route(PHOTO_PATH, chunked("image/jpeg", chunks, 20))
    await expectFailure(fake.download(PHOTO_URL, "photo", { timeoutMs: 150 }), "timeout")
    await waitUntil(() => fake.cutOff() > 0)
    expect(fake.cutOff()).toBe(1)
  })

  test("no reply within the stall limit is a stall", async () => {
    fake.route(PHOTO_PATH, late(2_000, file("image/jpeg", "bytes")))
    await expectFailure(fake.download(PHOTO_URL, "photo", { stallMs: 80 }), "stalled")
  })

  test("a body that stops halfway is a stall, and the part file is removed", async () => {
    fake.route(PHOTO_PATH, chunked("image/jpeg", ["abc", "def"], 2_000))
    const pending = fake.download(PHOTO_URL, "photo", { stallMs: 100 })
    await expectFailure(pending, "stalled")
  })

  test("an abort mid-body rejects with an AbortError and leaves nothing", async () => {
    fake.route(PHOTO_PATH, chunked("image/jpeg", ["abc", "def"], 2_000))
    const controller = new AbortController()
    const pending = rejected(fake.download(PHOTO_URL, "photo", { signal: controller.signal }))
    await waitUntil(() => fake.requests.length > 0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    controller.abort()
    expect(isAbortError(await pending)).toBe(true)
    expect(await fake.listing()).toEqual([])
    await waitUntil(() => fake.cutOff() > 0)
    expect(fake.cutOff()).toBe(1)
  })

  test("an already aborted signal rejects without a request", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(isAbortError(await rejected(fake.download(PHOTO_URL, "photo", { signal: controller.signal })))).toBe(true)
    expect(fake.requests).toEqual([])
  })
})

describe("downloadMedia never overwrites", () => {
  test.each([
    ["an empty file", () => writeFile(join(fake.dir, "123-1.jpg"), "")],
    ["a directory", () => mkdir(join(fake.dir, "123-1.jpg"))],
    ["a symlink", () => symlink(join(fake.dir, "elsewhere"), join(fake.dir, "123-1.jpg"))],
  ])("%s at the final name is the `exists` failure and is left as it was", async (_name, plant) => {
    await plant()
    const before = await fake.listing()
    fake.route(PHOTO_PATH, file("image/jpeg", "bytes"))
    expect(await fake.detailsOf(fake.download(PHOTO_URL))).toEqual({ source: "cdn", reason: "exists" })
    expect(await fake.listing()).toEqual(before)
  })

  test("a file that appears while downloading is reused, not written over", async () => {
    fake.route(PHOTO_PATH, (response) => {
      void writeFile(join(fake.dir, "123-1.jpg"), "winner").then(() => file("image/jpeg", "loser")(response))
    })
    const result = await fake.download(PHOTO_URL)
    expect(result).toEqual({ path: join(fake.dir, "123-1.jpg"), bytes: 6, mime: null, reused: true })
    expect(await readFile(result.path, "utf8")).toBe("winner")
    expect(await fake.listing()).toEqual(["123-1.jpg"])
  })
})
