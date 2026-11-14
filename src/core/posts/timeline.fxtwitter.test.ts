import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { sourcesFixture, type SourcesFixture } from "../sources/sources.testing"
import { removeTempDirs } from "../x/engine.testing"
import { cursorOf, fxListReply, fxRows, routeList } from "./list.testing"
import { NO_NOTE, fxTombstone, unexpectedMatch } from "./posts.testing"
import { UNTRUSTED_NOTE, postReadOutput, TABS } from "./schemas"
import { accountTimeline, accountUser, readerTimeline, timeline, timelinePath } from "./timeline.testing"
import { timelineOfAccount } from "./timeline"
import { requested } from "./view.testing"

let h: SourcesFixture

beforeEach(async () => {
  h = await sourcesFixture()
})

afterEach(async () => {
  await h.dispose()
  await removeTempDirs()
})

const ARGS = { handle: "ada_writes", tab: "posts" }
const PATH = timelinePath("ada_writes")

/** The posts' ids of a result. */
const idsOf = (result: { results?: { id: string }[] }) => result.results?.map((post) => post.id)

describe("a timeline from FxTwitter: what is asked", () => {
  test("asks each tab's route with count, and with_replies=1 for the replies only", async () => {
    for (const tab of TABS) routeList(h, timelinePath("ada_writes", tab), fxRows(["31"]))
    for (const tab of TABS) await timelineOfAccount(timeline("ada_writes", { tab }), h.reader())
    expect(requested(h)).toEqual([
      "/2/profile/ada_writes/statuses?count=20",
      "/2/profile/ada_writes/statuses?with_replies=1&count=20",
      "/2/profile/ada_writes/media?count=20",
    ])
  })

  test("reads the posts tab by default, and the handle with or without its @ in lower case", async () => {
    routeList(h, PATH, fxRows(["31", "32"]), "BOTTOM")
    const result = await timelineOfAccount(timeline("@Ada_Writes"), h.reader())
    expect(requested(h)).toEqual([PATH])
    expect(result).toEqual({
      method: "timeline",
      status: "ok",
      reason: null,
      results: [
        expect.objectContaining({ id: "31", community_note: NO_NOTE }),
        expect.objectContaining({ id: "32", community_note: NO_NOTE }),
      ],
      source: "fxtwitter",
      cursor: cursorOf("fxtwitter", "timeline", ARGS, "BOTTOM"),
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
    expect(h.accountReads).toEqual([])
  })

  test("count is the limit, and a cursor continues the page with FxTwitter's own cursor", async () => {
    const first = timelinePath("ada_writes", "replies", { count: "5" })
    const next = timelinePath("ada_writes", "replies", { count: "7", cursor: "BOTTOM 1/2=" })
    routeList(h, first, fxRows(["31"]), "BOTTOM 1/2=")
    routeList(h, next, fxRows(["32"]))
    const page = await timelineOfAccount(timeline("ada_writes", { tab: "replies", limit: 5 }), h.reader())
    const second = await timelineOfAccount(
      timeline("ada_writes", { tab: "replies", limit: 7, cursor: page.cursor! }),
      h.reader(),
    )
    expect(requested(h)).toEqual([first, next])
    expect(idsOf(second)).toEqual(["32"])
    expect(second).toMatchObject({ source: "fxtwitter", status: "ok", cursor: null })
  })

  test("keeps at most limit statuses, skips the rows that are none and stamps them with the time of the reply", async () => {
    h.clock.time = Date.parse("2026-03-04T05:06:07.890Z")
    const rows = [fxTombstone("deleted"), ...fxRows(["31", "32", "33"]), { type: "other" }]
    routeList(h, timelinePath("ada_writes", "media", { count: "2" }), rows, "BOTTOM")
    const result = await timelineOfAccount(timeline("ada_writes", { tab: "media", limit: 2 }), h.reader())
    expect(idsOf(result)).toEqual(["31", "32"])
    expect(result.results!.map((post) => post.read_at)).toEqual(Array(2).fill("2026-03-04T05:06:07Z"))
  })

  test("the cursor is the bottom cursor; no rows or no usable bottom leave none", async () => {
    const bodies: [string, unknown[], unknown, string | null][] = [
      ["no rows", [], { bottom: "BOTTOM" }, null],
      ["no cursor", fxRows(["31"]), null, null],
      ["an empty bottom", fxRows(["31"]), { bottom: "" }, null],
      ["a cursor of another shape", fxRows(["31"]), "BOTTOM", null],
      ["a bottom", fxRows(["31"]), { bottom: "BOTTOM" }, "BOTTOM"],
    ]
    for (const [name, rows, cursor, bottom] of bodies) {
      const { body } = fxListReply(rows)
      h.fake.route(PATH, { status: 200, body: { ...body, cursor } })
      const result = await timelineOfAccount(timeline("ada_writes"), h.reader())
      expect({ name, cursor: result.cursor }).toEqual({
        name,
        cursor: bottom && cursorOf("fxtwitter", "timeline", ARGS, bottom),
      })
    }
  })
})

describe("a timeline from FxTwitter: no timeline to read", () => {
  const nothing = { results: [], cursor: null, source: "fxtwitter" as const }
  const missing = { status: 404, body: { code: 404, message: "USER_NOT_FOUND" } }
  const suspended = { status: 404, body: { code: 404, message: "USER_NOT_FOUND", reason: "suspended" } }
  const protectedReply = { status: 401, body: { code: 401, message: "PRIVATE_USER" } }

  test("a 404 is final, with the reason FxTwitter gives, and the reading account is not asked", async () => {
    await h.label()
    const reader = readerTimeline(h, { user: accountUser(), timeline: accountTimeline(["31"]) })
    for (const [reply, reason] of [
      [suspended, "suspended"],
      [missing, "not_found"],
      [{ status: 404 }, "not_found"],
      [{ status: 404, body: '"gone"' }, "not_found"],
      [{ status: 404, body: { reason: "deleted" } }, "not_found"],
    ] as const) {
      h.fake.route(PATH, reply)
      const result = await timelineOfAccount(timeline("ada_writes"), reader)
      expect(result).toEqual({
        ...nothing,
        method: "timeline",
        status: "not_found",
        reason,
        note: UNTRUSTED_NOTE,
      })
      expect(postReadOutput.parse(result)).toEqual(result)
    }
    expect(h.accountReads).toEqual([])
  })

  test("a 401 is protected without a reading account, with no posts", async () => {
    h.fake.route(PATH, protectedReply)
    const result = await timelineOfAccount(timeline("ada_writes"), h.reader())
    expect(result).toEqual({
      ...nothing,
      method: "timeline",
      status: "protected",
      reason: "protected",
      note: UNTRUSTED_NOTE,
    })
    expect(postReadOutput.parse(result)).toEqual(result)
  })

  test("a 401 goes to the reading account under auto, and stays with FxTwitter under source fxtwitter", async () => {
    await h.label()
    h.fake.route(PATH, protectedReply)
    const answers = { user: accountUser(), timeline: accountTimeline(["31"], "ACC2") }
    const result = await timelineOfAccount(timeline("ada_writes"), readerTimeline(h, answers))
    expect(result).toMatchObject({
      source: "account",
      status: "ok",
      cursor: cursorOf("account", "timeline", ARGS, "ACC2"),
    })
    expect(h.accountReads.map((read) => read.op)).toEqual(["user", "timeline"])
    const pinned = await timelineOfAccount(timeline("ada_writes", { source: "fxtwitter" }), readerTimeline(h, answers))
    expect(pinned).toMatchObject({ ...nothing, status: "protected" })
    expect(h.accountReads).toHaveLength(2)
  })

  test("a reply off shape falls to the reading account under auto: a status, a body, a row", async () => {
    await h.label()
    const replies = [
      { status: 418, body: {} },
      { status: 200, body: { code: 200 } },
      { status: 200, body: { ...fxListReply([]).body, results: "none" } },
      { status: 200, body: fxListReply([{ type: "status", id: 5 }]).body },
    ]
    for (const reply of replies) {
      h.fake.route(PATH, reply)
      const answers = { user: accountUser(), timeline: accountTimeline(["31"]) }
      const result = await timelineOfAccount(timeline("ada_writes"), readerTimeline(h, answers))
      expect(result.source).toBe("account")
    }
  })

  test("without a reading account a reply off shape stands as an unexpected reply", async () => {
    h.fake.route(PATH, { status: 418, body: {} })
    expect(await rejected(timelineOfAccount(timeline("ada_writes"), h.reader()))).toMatchObject(
      unexpectedMatch("fxtwitter", 418),
    )
    h.fake.route(PATH, { status: 200, body: { code: 200 } })
    expect(await rejected(timelineOfAccount(timeline("ada_writes"), h.reader()))).toMatchObject(
      unexpectedMatch("fxtwitter", 200),
    )
  })
})
