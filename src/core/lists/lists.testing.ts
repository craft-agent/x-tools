import { accountPage } from "../posts/list.testing"
import { encodeCursor } from "../sources/cursor"
import type { ReaderOverrides } from "../sources/reader"
import type { SourcesFixture } from "../sources/sources.testing"
import type { Answerer } from "../sources/source"
import type { ToolOptions } from "../tool"
import { accountUsersPage } from "../users/users.testing"
import type { ListReadInput } from "./schemas"

/** Fixtures the list tests share: the arguments of each method, the bridge's pages and a reading account that answers its `list_posts` and `list_members` operations. */

/** The list the tests read. */
export const LIST_ID = "20"

/** The bridge's `list_posts` data: the posts of `ids`, and the cursor of the next page. */
export const listPostsPage = accountPage

/** The bridge's `list_members` data: the accounts of `handles`, and the cursor of the next page. */
export const listMembersPage = accountUsersPage

/** Arguments for `listPosts`. */
export const posts = (list: string, extra: Partial<ListReadInput> = {}): ListReadInput => ({
  method: "posts",
  list,
  ...extra,
})

/** Arguments for `listMembers`. */
export const members = (list: string, extra: Partial<ListReadInput> = {}): ListReadInput => ({
  method: "members",
  list,
  ...extra,
})

/** The cursor a read of a list gets for `own` from `source`, for the `args` that decide what it reads; the list's posts unless `read` says otherwise. */
export const cursorOf = (source: Answerer, args: Record<string, unknown>, own: string, read = "list_posts") =>
  encodeCursor({ source, read, args, cursor: own })

/** What the reading account answers each operation with; `undefined` for one the test does not expect. */
export type ListAnswers = { list_posts?: unknown; list_members?: unknown }

/** What the bridge was asked in `h`, per read. */
export const asked = (h: SourcesFixture) => h.accountReads.map(({ op, args }) => ({ op, args }))

/** A reader whose reading account answers each operation with its entry of `answers`; each read is recorded in `h.accountReads`. */
export function readerLists(
  h: SourcesFixture,
  answers: ListAnswers,
  options?: ToolOptions,
  overrides: ReaderOverrides = {},
) {
  return h.reader(options, {
    readAccount: async (readOptions) => {
      h.accountReads.push(readOptions)
      return { account: readOptions.account ?? "default", data: answers[readOptions.op as keyof ListAnswers] }
    },
    ...overrides,
  })
}
