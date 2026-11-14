import { z } from "zod"
import { MAX_LINKS, MAX_NAME, clipCodePoints, type PostGone } from "../posts/shape"

/** The most characters of a profile's bio a result keeps. */
export const MAX_BIO = 600

export const userCountsSchema = z.object({
  followers: z.number().nullable(),
  following: z.number().nullable(),
  posts: z.number().nullable(),
  likes: z.number().nullable(),
  media: z.number().nullable(),
})

export const userSchema = z.object({
  id: z.string(),
  handle: z.string().describe("The account's handle, without the @."),
  name: z.string(),
  url: z.string().describe("The profile's URL on x.com."),
  bio: z.string(),
  links: z.array(z.string()).describe("The addresses of the profile: its website, then the links in its bio."),
  location: z.string().nullable().describe("The location the profile gives; null when it gives none."),
  joined: z
    .string()
    .nullable()
    .describe("When the account was created, ISO 8601 in UTC to the second; null when not told."),
  counts: userCountsSchema.describe("A count the source did not give is null, never 0."),
  protected: z.boolean().nullable().describe("The account's posts are private; null when the source does not tell."),
  verified: z
    .boolean()
    .nullable()
    .describe("The account has any checkmark; null when the source does not tell. The kind is in `verified_type`."),
  verified_type: z
    .string()
    .nullable()
    .describe("The kind of checkmark, lowercased, such as `government` or `business`; null when none is told."),
  avatar_url: z.string().nullable(),
  banner_url: z.string().nullable(),
  read_at: z
    .string()
    .describe(
      "When the source answered this profile, ISO 8601 in UTC to the second, so reads taken at other times compare.",
    ),
  clipped: z.array(z.string()).describe('The fields that were clipped: "name", "bio" or "links".'),
})

export type UserCounts = z.infer<typeof userCountsSchema>
/** One account's profile, whichever source answered; a field a source does not give is null. */
export type User = z.infer<typeof userSchema>
/** A profile before its clipping: `clipUser` fills `clipped`. */
export type RawUser = Omit<User, "clipped">

/** What a lookup of one profile came to: the profile, or why there is none. */
export type UserLookup = { status: "ok"; user: User } | PostGone

/** The canonical URL of a profile. */
export function userUrl(handle: string): string {
  return `https://x.com/${handle}`
}

/** `location` as the profile gives it, null when it is empty. */
export function locationOf(location: string | null | undefined): string | null {
  return location === null || location === undefined || location.trim() === "" ? null : location
}

/** `text` lowercased, null when it is empty or left out. */
export function lowercaseOrNull(text: string | null | undefined): string | null {
  const lowercased = text?.trim().toLowerCase()
  return lowercased ? lowercased : null
}

/**
 * The profile with its name clipped to `MAX_NAME` code points, its bio to
 * `MAX_BIO` and its links to `MAX_LINKS`; `clipped` names what was cut (empty
 * when nothing was).
 */
export function clipUser(raw: RawUser): User {
  const clipped: string[] = []
  const name = clipCodePoints(raw.name, MAX_NAME)
  const bio = clipCodePoints(raw.bio, MAX_BIO)
  const links = raw.links.slice(0, MAX_LINKS)
  if (name !== raw.name) clipped.push("name")
  if (bio !== raw.bio) clipped.push("bio")
  if (links.length !== raw.links.length) clipped.push("links")
  return { ...raw, name, bio, links, clipped }
}
