import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { fxMosaic, fxTombstone } from "../posts/posts.testing"
import { routeGone, routePost, routeProtected, statusPath } from "../posts/view.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { readMediaFromAccount, readMediaFromFxTwitter } from "./post-media"
import { fxPhoto, fxStatus, fxVideo, photoUrl, videoUrl } from "./save.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const format = (container: string, url: string, fields: Record<string, unknown> = {}) => ({ container, url, ...fields })
const fxRead = (id = "20") => readMediaFromFxTwitter(h.reader().fxtwitter(), id)

describe("readMediaFromFxTwitter", () => {
  test("reads the media in the post's order, a photo by its own URL and a mosaic skipped", async () => {
    const media = { all: [fxPhoto({ url: photoUrl("a") }), fxMosaic(), fxVideo("gif", { url: videoUrl("g") })] }
    routePost(h, "20", "ada_writes", { media })
    expect(await fxRead()).toEqual({
      kind: "answer",
      value: {
        status: "ok",
        items: [
          { kind: "photo", url: photoUrl("a") },
          { kind: "gif", url: videoUrl("g") },
        ],
        quote: null,
      },
    })
  })

  test("a video takes the mp4 format with the highest bitrate, a missing bitrate counting 0", async () => {
    const formats = [
      format("m3u8", videoUrl("playlist"), { bitrate: 9_000_000 }),
      format("mp4", videoUrl("low"), { bitrate: 832_000 }),
      format("mp4", videoUrl("unrated")),
      format("mp4", videoUrl("high"), { bitrate: 2_176_000 }),
      format("mp4", videoUrl("equal"), { bitrate: 2_176_000 }),
    ]
    routePost(h, "20", "ada_writes", { media: { all: [fxVideo("video", { url: videoUrl("own"), formats })] } })
    const outcome = await fxRead()
    expect(outcome.value).toMatchObject({ items: [{ kind: "video", url: videoUrl("high") }] })

    const unrated = [format("mp4", videoUrl("first")), format("mp4", videoUrl("second"))]
    routePost(h, "21", "ada_writes", { media: { all: [fxVideo("video", { formats: unrated })] } })
    expect((await fxRead("21")).value).toMatchObject({ items: [{ url: videoUrl("first") }] })
  })

  test("without an mp4 format a video falls back to its own URL when it ends in .mp4 before the query", async () => {
    const formats = [format("m3u8", videoUrl("playlist"), { bitrate: 1 })]
    const own = (url: string, extra: Record<string, unknown> = {}) => fxVideo("video", { url, ...extra })
    const all = [
      own(`${videoUrl("clip")}?tag=12`, { formats }),
      own("https://video.twimg.com/ext/pl.m3u8?x=.mp4", { formats }),
      own(videoUrl("odd"), { formats: "not a list" }),
    ]
    routePost(h, "20", "ada_writes", { media: { all } })
    expect((await fxRead()).value).toMatchObject({
      items: [{ url: `${videoUrl("clip")}?tag=12` }, { url: null }, { url: videoUrl("odd") }],
    })
  })

  test("the quote's media come from the same reply, and a tombstone is no quote", async () => {
    const quote = fxStatus({ id: "21", media: { all: [fxPhoto({ url: photoUrl("q") })] } })
    routePost(h, "20", "ada_writes", { quote })
    expect((await fxRead()).value).toMatchObject({ items: [], quote: { id: "21", items: [{ url: photoUrl("q") }] } })
    routePost(h, "22", "ada_writes", { quote: fxTombstone("deleted") })
    expect((await fxRead("22")).value).toMatchObject({ quote: null })
    expect(h.fake.requests.map((request) => request.path)).toEqual([statusPath("20"), statusPath("22")])
  })

  test("answers as x_post_read does for a gone and a protected post", async () => {
    routeGone(h, "20", "deleted")
    expect(await fxRead()).toEqual({
      kind: "answer",
      value: { status: "not_found", reason: "deleted" },
    })
    routeProtected(h, "21")
    expect(await fxRead("21")).toMatchObject({ kind: "fallback", value: { status: "protected" } })
  })

  test("a status off shape is an unexpected_reply", async () => {
    routePost(h, "20", "ada_writes", { media: { all: [{ type: "photo" }] } })
    await expect(fxRead()).rejects.toMatchObject({
      code: "upstream_error",
      details: { source: "fxtwitter", reason: "unexpected_reply" },
    })
  })
})

describe("readMediaFromAccount", () => {
  const read = (data: unknown) =>
    readMediaFromAccount(h.reader({}, { readAccount: async () => ({ account: "a", data }) }), "20")

  test("reads the bridge's media as they are, and the quote's", async () => {
    const quote = { id: "21", media: [{ type: "gif", url: videoUrl("g") }] }
    const data = {
      id: "20",
      media: [
        { type: "photo", url: photoUrl("a") },
        { type: "video", url: videoUrl("v") },
      ],
      quote,
    }
    expect(await read(data)).toEqual({
      status: "ok",
      items: [
        { kind: "photo", url: photoUrl("a") },
        { kind: "video", url: videoUrl("v") },
      ],
      quote: { id: "21", items: [{ kind: "gif", url: videoUrl("g") }] },
    })
  })

  test("no tweet is not_found, and data off shape an unexpected_reply", async () => {
    expect(await read(null)).toEqual({ status: "not_found", reason: "not_found" })
    await expect(read({ id: "20", media: [{ type: "mosaic", url: "x" }] })).rejects.toMatchObject({
      details: { source: "account", reason: "unexpected_reply" },
    })
  })
})
