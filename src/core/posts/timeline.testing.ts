import { DEFAULT_LIMIT } from "../sources/page"
import type { ReaderOverrides } from "../sources/reader"
import type { SourcesFixture } from "../sources/sources.testing"
import type { ToolOptions } from "../tool"
import { accountPage } from "./list.testing"
import type { PostReadInput, Tab } from "./schemas"

/** Fixtures the timeline tests share: the arguments of the method, the paths FxTwitter is asked and a reading account that answers its `user` and `timeline` operations. */

/** Arguments for `timelineOfAccount`. */
export const timeline = (handle: string, extra: Partial<PostReadInput> = {}): PostReadInput => ({
  method: "timeline",
  handle,
  ...extra,
})

/** The path and query string FxTwitter is asked for a tab of an account: `params` follow the tab's own field, in the order the code writes them. */
export const timelinePath = (
  handle: string,
  tab: Tab = "posts",
  params: Record<string, string> = { count: String(DEFAULT_LIMIT) },
): string => {
  const route = tab === "media" ? "media" : "statuses"
  const own: Record<string, string> = tab === "replies" ? { with_replies: "1" } : {}
  return `/2/profile/${handle}/${route}?${new URLSearchParams({ ...own, ...params })}`
}

/** What the bridge's `user` operation gives for an account: the user id, and some of the fields the next reads use. */
export const accountUser = (id = "4001", handle = "ada_writes") => ({ id, username: handle, displayname: "Ada Writes" })

/** What the bridge's `timeline` operation gives: the posts of `ids`, and the cursor of the next page. */
export const accountTimeline = accountPage

/** What the reading account answers each operation with; `undefined` for one the test does not expect. */
export type TimelineAnswers = { user?: unknown; timeline?: unknown }

/** A reader whose reading account answers the `user` operation with `answers.user` and every other with `answers.timeline`; each read is recorded in `h.accountReads`. */
export function readerTimeline(
  h: SourcesFixture,
  answers: TimelineAnswers,
  options?: ToolOptions,
  overrides: ReaderOverrides = {},
) {
  return h.reader(options, {
    readAccount: async (readOptions) => {
      h.accountReads.push(readOptions)
      const data = readOptions.op === "user" ? answers.user : answers.timeline
      return { account: readOptions.account ?? "default", data }
    },
    ...overrides,
  })
}
