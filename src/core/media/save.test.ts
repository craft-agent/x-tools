import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { routeProtected } from "../posts/view.testing"
import { USER_AGENT } from "../sources/sources.testing"
import { file } from "./media.testing"
import { mediaDownloadOutput, SAVED_MEDIA_NOTE } from "./schemas"
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

const requested = (): string[] => s.cdn.requests.map((request) => request.path)
const mp4 = (name: string, bitrate: number) => ({ container: "mp4", url: videoUrl(name), bitrate })

describe("x_media_download: saving from FxTwitter", () => {
  test("saves photos at original size, named after the post, and sends only a User-Agent", async () => {
    routePost(s.h, "20", "ada_writes", {
      media: { all: [fxPhoto({ url: photoUrl("a") }), fxPhoto({ url: photoUrl("b") })] },
    })
    s.cdn.route("/media/a.jpg?name=orig", file("image/jpeg", "first"))
    s.cdn.route("/media/b.jpg?name=orig", file("image/webp", "second!"))

    const result = await s.save({ post: "https://x.com/ada_writes/status/20" })

    const folder = join(s.cdn.dir, "20")
    expect(mediaDownloadOutput.parse(result)).toEqual({
      post: "20",
      folder,
      files: [
        { path: join(folder, "20-1.jpg"), kind: "photo", from: "20", bytes: 5, reused: false },
        { path: join(folder, "20-2.webp"), kind: "photo", from: "20", bytes: 7, reused: false },
      ],
      failed: [],
      source: "fxtwitter",
      note: SAVED_MEDIA_NOTE,
    })
    expect(await readFile(join(folder, "20-2.webp"), "utf8")).toBe("second!")
    expect(requested()).toEqual(["/media/a.jpg?name=orig", "/media/b.jpg?name=orig"])
    for (const { headers } of s.cdn.requests) {
      expect(headers["user-agent"]).toBe(USER_AGENT)
      expect(headers.cookie).toBeUndefined()
      expect(headers.authorization).toBeUndefined()
    }
    expect(await s.cdn.listing()).toEqual(["20"])
  })

  test("saves a video as its highest-bitrate MP4 and a GIF as an MP4, numbered in the post's order", async () => {
    const formats = [
      mp4("low", 832_000),
      mp4("high", 2_176_000),
      { container: "m3u8", url: videoUrl("pl"), bitrate: 9e6 },
    ]
    const all = [
      fxVideo("video", { url: videoUrl("own"), formats }),
      fxPhoto({ url: photoUrl("a") }),
      fxVideo("gif", { url: videoUrl("g") }),
    ]
    routePost(s.h, "20", "ada_writes", { media: { all } })
    s.cdn.route("/ext_tw_video/1/pu/vid/high.mp4", file("video/mp4", "video-bytes"))
    s.cdn.route("/media/a.jpg?name=orig", file("image/png", "png"))
    s.cdn.route("/ext_tw_video/1/pu/vid/g.mp4", file("video/mp4", "gif-bytes"))

    const { files, failed } = await s.save({ post: "20" })

    expect(files.map(({ path, kind }) => [path.slice(s.cdn.dir.length + 1), kind])).toEqual([
      [join("20", "20-1.mp4"), "video"],
      [join("20", "20-2.png"), "photo"],
      [join("20", "20-3.mp4"), "gif"],
    ])
    expect(failed).toEqual([])
    expect(requested()).toEqual([
      "/ext_tw_video/1/pu/vid/high.mp4",
      "/media/a.jpg?name=orig",
      "/ext_tw_video/1/pu/vid/g.mp4",
    ])
  })

  test("saves the quoted post's media only when asked, under the quote's own id", async () => {
    const quote = fxStatus({ id: "21", media: { all: [fxPhoto({ url: photoUrl("q") })] } })
    routePost(s.h, "20", "ada_writes", { media: { all: [fxPhoto({ url: photoUrl("a") })] }, quote })
    s.cdn.route("/media/a.jpg?name=orig", file("image/jpeg", "post"))
    s.cdn.route("/media/q.jpg?name=orig", file("image/jpeg", "quote"))

    const without = await s.save({ post: "20", quoted: false })
    expect(without.files.map(({ from }) => from)).toEqual(["20"])
    expect(requested()).toEqual(["/media/a.jpg?name=orig"])

    const withQuote = await s.save({ post: "20", quoted: true })
    expect(withQuote.files).toEqual([
      expect.objectContaining({ path: join(s.cdn.dir, "20", "20-1.jpg"), from: "20", reused: true }),
      expect.objectContaining({ path: join(s.cdn.dir, "20", "21-1.jpg"), from: "21", reused: false, bytes: 5 }),
    ])
  })

  test("keeps a file that is already there, reports it reused and downloads nothing again", async () => {
    routePost(s.h, "20", "ada_writes", { media: { all: [fxPhoto({ url: photoUrl("a") })] } })
    s.cdn.route("/media/a.jpg?name=orig", file("image/jpeg", "original"))
    await s.save({ post: "20" })
    s.cdn.route("/media/a.jpg?name=orig", file("image/jpeg", "changed upstream"))

    const again = await s.save({ post: "20" })

    expect(again.files).toEqual([expect.objectContaining({ bytes: 8, reused: true })])
    expect(await readFile(join(s.cdn.dir, "20", "20-1.jpg"), "utf8")).toBe("original")
    expect(requested()).toEqual(["/media/a.jpg?name=orig"])
  })
})

describe("x_media_download: saving through the reading account", () => {
  const media = [
    { type: "photo", url: photoUrl("p") },
    { type: "video", url: videoUrl("best") },
  ]

  test("saves the post and the quote the bridge gives, its video URL as it is", async () => {
    await s.h.label()
    const quote = { id: "21", media: [{ type: "gif", url: videoUrl("g") }] }
    const answers = { "20": s.accountPost("20", media, quote) }
    s.cdn.route("/media/p.jpg?name=orig", file("image/jpeg", "photo"))
    s.cdn.route("/ext_tw_video/1/pu/vid/best.mp4", file("video/mp4", "video"))
    s.cdn.route("/ext_tw_video/1/pu/vid/g.mp4", file("video/mp4", "gif"))

    const result = await s.save({ post: "20", quoted: true, source: "account" }, { answers })

    expect(result.source).toBe("account")
    expect(result.files.map(({ path, kind, from }) => [path.slice(result.folder.length + 1), kind, from])).toEqual([
      ["20-1.jpg", "photo", "20"],
      ["20-2.mp4", "video", "20"],
      ["21-1.mp4", "gif", "21"],
    ])
    expect(s.h.fake.requests).toEqual([])
    expect(s.h.accountReads).toHaveLength(1)
  })

  test("auto falls to the reading account for a protected post", async () => {
    await s.h.label()
    routeProtected(s.h, "20")
    s.cdn.route("/media/p.jpg?name=orig", file("image/jpeg", "photo"))
    s.cdn.route("/ext_tw_video/1/pu/vid/best.mp4", file("video/mp4", "video"))

    const result = await s.save({ post: "20" }, { answers: { "20": s.accountPost("20", media) } })

    expect(result.source).toBe("account")
    expect(result.files).toHaveLength(2)
  })
})
