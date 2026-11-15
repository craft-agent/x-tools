import { accountPage } from "../posts/list.testing"
import { encodeCursor } from "../sources/cursor"
import type { ReaderOverrides } from "../sources/reader"
import type { SourcesFixture } from "../sources/sources.testing"
import type { Answerer } from "../sources/source"
import type { ToolOptions } from "../tool"
import { accountUsersPage } from "../users/users.testing"
import type { CommunityReadInput } from "./schemas"

/** Fixtures the community tests share: the arguments of each method, the bridge's data and a reading account that answers its `community`, `community_posts` and `community_members` operations. */

/** The community the tests read. */
export const COMMUNITY_ID = "20"

/** The bridge's `community` data, as it gives a community with every field; `extra` replaces fields. */
export const communityData = (extra: Record<string, unknown> = {}) => ({
  id: COMMUNITY_ID,
  name: "Typesetters",
  description: "Letters and the people who set them.",
  rules: [{ name: "Be kind", description: "No pile-ons." }],
  member_count: 1234,
  join_policy: "Open",
  topic: "Design",
  nsfw: false,
  created_at: "2024-05-06T07:08:09.000Z",
  is_member: true,
  ...extra,
})

/** The bridge's `community_posts` data: the posts of `ids`, and the cursor of the next page. */
export const communityPostsPage = accountPage

/** The bridge's `community_members` data: the accounts of `handles`, and the cursor of the next page. */
export const communityMembersPage = accountUsersPage

/** Arguments for `viewCommunity`. */
export const view = (community: string, extra: Partial<CommunityReadInput> = {}): CommunityReadInput => ({
  method: "view",
  community,
  ...extra,
})

/** Arguments for `communityPosts`. */
export const posts = (community: string, extra: Partial<CommunityReadInput> = {}): CommunityReadInput => ({
  method: "posts",
  community,
  ...extra,
})

/** Arguments for `communityMembers`. */
export const members = (community: string, extra: Partial<CommunityReadInput> = {}): CommunityReadInput => ({
  method: "members",
  community,
  ...extra,
})

/** The cursor a read of a community gets for `own` from `source`, for the `args` that decide what it reads; the community's posts unless `read` says otherwise. */
export const cursorOf = (source: Answerer, args: Record<string, unknown>, own: string, read = "community_posts") =>
  encodeCursor({ source, read, args, cursor: own })

/** What the reading account answers each operation with; `undefined` for one the test does not expect. */
export type CommunityAnswers = { community?: unknown; community_posts?: unknown; community_members?: unknown }

/** What the bridge was asked in `h`, per read. */
export const asked = (h: SourcesFixture) => h.accountReads.map(({ op, args }) => ({ op, args }))

/** A reader whose reading account answers each operation with its entry of `answers`; each read is recorded in `h.accountReads`. */
export function readerCommunities(
  h: SourcesFixture,
  answers: CommunityAnswers,
  options?: ToolOptions,
  overrides: ReaderOverrides = {},
) {
  return h.reader(options, {
    readAccount: async (readOptions) => {
      h.accountReads.push(readOptions)
      return { account: readOptions.account ?? "default", data: answers[readOptions.op as keyof CommunityAnswers] }
    },
    ...overrides,
  })
}
