import { describe, expect, test } from "bun:test"
import { READ_AT, sampleLinks, unexpectedMatch } from "../posts/posts.testing"
import { MAX_LINKS, MAX_NAME } from "../posts/shape"
import { thrown } from "../sources/sources.testing"
import { userFromAccount } from "./account"
import { userFromFxTwitter } from "./fxtwitter"
import { MAX_BIO, userSchema, type User } from "./shape"
import { accountProfile, fxProfile } from "./users.testing"

describe("a profile from FxTwitter", () => {
  test("is the profile's fields, with the counts renamed, the links gathered and the join time parsed", () => {
    const user = userFromFxTwitter(fxProfile(), READ_AT)
    expect(user).toEqual({
      id: "4001",
      handle: "ada_writes",
      name: "Ada Writes",
      url: "https://x.com/ada_writes",
      bio: "Notes on reading slowly. https://t.co/abc",
      links: ["https://example.test/ada", "https://example.test/notes"],
      location: "Lisbon",
      joined: "2007-12-19T20:20:32Z",
      counts: { followers: 1200, following: 85, posts: 3400, likes: 9000, media: 210 },
      protected: false,
      verified: true,
      verified_type: "government",
      avatar_url: "https://pbs.example.test/profile/ada.jpg",
      banner_url: "https://pbs.example.test/banner/ada.jpg",
      read_at: READ_AT,
      clipped: [],
    })
    expect(userSchema.parse(user)).toEqual(user)
  })

  test("takes its links from the website, then the bio's link facets, each once and in order", () => {
    const facets = [
      { type: "url", replacement: "https://example.test/notes" },
      { type: "mention", replacement: "https://example.test/not-a-link" },
      { type: "url", replacement: "https://example.test/ada" },
      { type: "url", replacement: null },
      { type: "url" },
      { type: "url", replacement: "" },
    ]
    const row = fxProfile({ raw_description: { text: "", facets } })
    expect(userFromFxTwitter(row, READ_AT).links).toEqual(["https://example.test/ada", "https://example.test/notes"])
    expect(userFromFxTwitter(fxProfile({ website: null, raw_description: null }), READ_AT).links).toEqual([])
  })

  test("a join time that does not parse is null, and a field left out is null or empty", () => {
    for (const joined of ["2007-12-19T20:20:32Z", "Wed Dec 19 2007", "", null]) {
      expect(userFromFxTwitter(fxProfile({ joined }), READ_AT).joined).toBeNull()
    }
    const bare = { type: "profile", id: "7", screen_name: "bare", name: "Bare" }
    expect(userFromFxTwitter(bare, READ_AT)).toEqual({
      id: "7",
      handle: "bare",
      name: "Bare",
      url: "https://x.com/bare",
      bio: "",
      links: [],
      location: null,
      joined: null,
      counts: { followers: null, following: null, posts: null, likes: null, media: null },
      protected: null,
      verified: null,
      verified_type: null,
      avatar_url: null,
      banner_url: null,
      read_at: READ_AT,
      clipped: [],
    })
  })

  test("a location that is empty is null, and a checkmark without a kind has none told", () => {
    const row = fxProfile({ location: "  ", verification: { verified: false, type: "" } })
    expect(userFromFxTwitter(row, READ_AT)).toMatchObject({ location: null, verified: false, verified_type: null })
  })

  test("a row off shape is an unexpected reply of FxTwitter", () => {
    for (const row of [
      null,
      "ada",
      {},
      fxProfile({ type: "status" }),
      fxProfile({ id: 4001 }),
      fxProfile({ name: null }),
    ]) {
      expect(thrown(() => userFromFxTwitter(row, READ_AT))).toMatchObject(unexpectedMatch("fxtwitter", 200))
    }
  })
})

describe("a profile from the reading account", () => {
  test("is the bridge's fields in the same shape, with the join time in UTC", () => {
    const user = userFromAccount(accountProfile(), READ_AT)
    expect(user).toEqual({
      id: "4001",
      handle: "ada_writes",
      name: "Ada Writes",
      url: "https://x.com/ada_writes",
      bio: "Notes on reading slowly.",
      links: ["https://example.test/ada", "https://example.test/notes"],
      location: "Lisbon",
      joined: "2013-05-04T09:15:30Z",
      counts: { followers: 1200, following: 85, posts: 3400, likes: 9000, media: 210 },
      protected: false,
      verified: true,
      verified_type: "business",
      avatar_url: "https://pbs.example.test/profile/ada.jpg",
      banner_url: "https://pbs.example.test/banner/ada.jpg",
      read_at: READ_AT,
      clipped: [],
    })
    expect(userSchema.parse(user)).toEqual(user)
  })

  test("verified is any checkmark, and null only when the bridge tells neither", () => {
    const verified = (fields: Record<string, unknown>) => userFromAccount(accountProfile(fields), READ_AT).verified
    expect(verified({ verified: true, blue: false })).toBe(true)
    expect(verified({ verified: false, blue: true })).toBe(true)
    expect(verified({ verified: false, blue: false })).toBe(false)
    expect(verified({ verified: null, blue: true })).toBe(true)
    expect(verified({ verified: false, blue: null })).toBe(false)
    expect(verified({ verified: null, blue: null })).toBeNull()
  })

  test("a kind of checkmark is lowercased, and none is null; an empty location is null", () => {
    const user = (fields: Record<string, unknown>) => userFromAccount(accountProfile(fields), READ_AT)
    expect(user({ blue_type: "Government" }).verified_type).toBe("government")
    expect(user({ blue_type: null }).verified_type).toBeNull()
    expect(user({ blue_type: "" }).verified_type).toBeNull()
    expect(user({ location: "" }).location).toBeNull()
    expect(user({ created: null }).joined).toBeNull()
    expect(user({ created: "yesterday" }).joined).toBeNull()
  })

  test("a field the bridge leaves out is null or empty", () => {
    const user = userFromAccount({ id: "7", username: "bare", displayname: "Bare" }, READ_AT)
    expect(user).toMatchObject({ bio: "", links: [], location: null, joined: null, verified: null, protected: null })
    expect(user.counts).toEqual({ followers: null, following: null, posts: null, likes: null, media: null })
  })

  test("data off the operation's shape is an unexpected reply of the account", () => {
    for (const data of [undefined, "ada", {}, accountProfile({ id: "ada" }), accountProfile({ links: "none" })]) {
      expect(thrown(() => userFromAccount(data, READ_AT))).toMatchObject(unexpectedMatch("account"))
    }
  })
})

describe("clipping a profile", () => {
  const clipped = (fields: Partial<Record<string, unknown>>): User => userFromFxTwitter(fxProfile(fields), READ_AT)

  test("keeps a name, a bio and links within their limits whole", () => {
    const user = clipped({ name: "n".repeat(MAX_NAME), description: "b".repeat(MAX_BIO) })
    expect(user.name).toHaveLength(MAX_NAME)
    expect(user.bio).toHaveLength(MAX_BIO)
    expect(user.clipped).toEqual([])
  })

  test("clips the name to 50, the bio to 600 and the links to 5, by code points, and says which", () => {
    const facets = sampleLinks(MAX_LINKS + 2).map((replacement) => ({ type: "url", replacement }))
    const user = clipped({
      name: "😀".repeat(MAX_NAME + 1),
      description: "😀".repeat(MAX_BIO + 1),
      raw_description: { text: "", facets },
      website: null,
    })
    expect(Array.from(user.name)).toHaveLength(MAX_NAME)
    expect(Array.from(user.bio)).toHaveLength(MAX_BIO)
    expect(user.links).toEqual(sampleLinks(MAX_LINKS))
    expect(user.clipped).toEqual(["name", "bio", "links"])
  })

  test("clips the same through the reading account", () => {
    const user = userFromAccount(
      accountProfile({ displayname: "n".repeat(MAX_NAME + 1), links: sampleLinks(MAX_LINKS + 1) }),
      READ_AT,
    )
    expect(user.clipped).toEqual(["name", "links"])
    expect(user.links).toHaveLength(MAX_LINKS)
  })
})
