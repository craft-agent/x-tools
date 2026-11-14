import { encodeCursor } from "../sources/cursor"
import { DEFAULT_LIMIT } from "../sources/page"
import type { ReaderOverrides } from "../sources/reader"
import type { SourcesFixture } from "../sources/sources.testing"
import type { Answerer } from "../sources/source"
import type { ToolOptions } from "../tool"
import type { UserReadInput } from "./schemas"

/** Fixtures the user tests share: FxTwitter's v2 profile as its schema writes it, the bridge's user dict, the arguments of each method and a reading account that answers its `user` and `user_search` operations, with made-up ids and handles. */

export const USER_ID = "4001"

type Json = Record<string, unknown>

/** A v2 `APIUser` row as FxTwitter's profile and user search carry it; `fields` replace any of it. */
export function fxProfile(fields: Json = {}): Json {
  const handle = (fields.screen_name as string | undefined) ?? "ada_writes"
  return {
    type: "profile",
    id: USER_ID,
    screen_name: handle,
    url: `https://x.com/${handle}`,
    name: "Ada Writes",
    description: "Notes on reading slowly. https://t.co/abc",
    raw_description: {
      text: "Notes on reading slowly. https://t.co/abc",
      facets: [
        { type: "url", indices: [26, 40], original: "https://t.co/abc", replacement: "https://example.test/notes" },
      ],
    },
    location: "Lisbon",
    joined: "Wed Dec 19 20:20:32 +0000 2007",
    followers: 1200,
    following: 85,
    statuses: 3400,
    likes: 9000,
    media_count: 210,
    protected: false,
    website: { url: "https://example.test/ada", display_url: "example.test/ada" },
    verification: { verified: true, verified_at: null, type: "Government" },
    avatar_url: "https://pbs.example.test/profile/ada.jpg",
    banner_url: "https://pbs.example.test/banner/ada.jpg",
    ...fields,
  }
}

/** FxTwitter's `200` reply for a profile page. */
export const fxProfileReply = (profile: unknown = fxProfile()) => ({
  status: 200,
  body: { code: 200, message: "OK", user: profile },
})

/** The profiles of `handles`, as a search of users carries them. */
export const fxProfileRows = (handles: string[]): unknown[] =>
  handles.map((handle) => fxProfile({ screen_name: handle }))

/** What the bridge's `user` operation gives for an account; `fields` replace any of it. */
export function accountProfile(fields: Json = {}): Json {
  return {
    id: USER_ID,
    username: "ada_writes",
    displayname: "Ada Writes",
    description: "Notes on reading slowly.",
    location: "Lisbon",
    created: "2013-05-04T09:15:30+00:00",
    followers: 1200,
    following: 85,
    posts: 3400,
    media: 210,
    likes: 9000,
    listed: 14,
    protected: false,
    verified: false,
    blue: true,
    blue_type: "Business",
    links: ["https://example.test/ada", "https://example.test/notes"],
    avatar: "https://pbs.example.test/profile/ada.jpg",
    banner: "https://pbs.example.test/banner/ada.jpg",
    pinned: ["1700000000000000009"],
    ...fields,
  }
}

/** What the bridge's `user_search` operation gives: the accounts of `handles`, and the cursor of the next page. */
export const accountUsersPage = (handles: string[], cursor: string | null = null) => ({
  users: handles.map((handle) => accountProfile({ username: handle })),
  cursor,
})

/** Arguments for `viewUser`. */
export const view = (handle: string, extra: Partial<UserReadInput> = {}): UserReadInput => ({
  method: "view",
  handle,
  ...extra,
})

/** Arguments for `searchUsers`. */
export const search = (query: string, extra: Partial<UserReadInput> = {}): UserReadInput => ({
  method: "search",
  query,
  ...extra,
})

/** The path FxTwitter is asked for a profile. */
export const profilePath = (handle: string): string => `/2/profile/${handle}`

/** The path and query string FxTwitter is asked for a search of users: `params` in the order the code writes them. */
export const searchPath = (params: Record<string, string>): string => `/2/search/users?${new URLSearchParams(params)}`

/** The path FxTwitter is asked for the first page of a search of users for `query`. */
export const firstSearchPath = (query: string): string => searchPath({ q: query, count: String(DEFAULT_LIMIT) })

/** The cursor a search of users gets for `own` from `source`, for the `args` that decide what it reads. */
export const cursorOf = (source: Answerer, args: Record<string, unknown>, own: string) =>
  encodeCursor({ source, read: "user_search", args, cursor: own })

/** What the reading account answers each operation with; `undefined` for one the test does not expect. */
export type UserAnswers = { user?: unknown; user_search?: unknown }

/** A reader whose reading account answers the `user` operation with `answers.user` and `user_search` with `answers.user_search`; each read is recorded in `h.accountReads`. */
export function readerUsers(
  h: SourcesFixture,
  answers: UserAnswers,
  options?: ToolOptions,
  overrides: ReaderOverrides = {},
) {
  return h.reader(options, {
    readAccount: async (readOptions) => {
      h.accountReads.push(readOptions)
      const data = readOptions.op === "user" ? answers.user : answers.user_search
      return { account: readOptions.account ?? "default", data }
    },
    ...overrides,
  })
}
