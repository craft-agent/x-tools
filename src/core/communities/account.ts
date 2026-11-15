import { z } from "zod"
import { ToolError } from "../errors"
import { MAX_NAME, clipCodePoints, isoUtc, nullishNumber, unexpectedReplyError } from "../posts/shape"
import { MAX_BIO, lowercaseOrNull } from "../users/shape"
import { MAX_RULES, type Community } from "./schemas"

/** The bridge's `community` operation. */
export const COMMUNITY_OPERATION = "community"

/** The bridge's `community_posts` operation. */
export const COMMUNITY_POSTS_OPERATION = "community_posts"

/** The bridge's `community_members` operation. */
export const COMMUNITY_MEMBERS_OPERATION = "community_members"

/** What a community X gives the reading account no data for is told: X's reply for a removed community is not told apart from one for a missing community. */
export const COMMUNITY_NOT_FOUND_MESSAGE =
  "X shows no such community to the reading account: it may not exist, or have been removed."

/** The error of a community the bridge gave no data for. */
export function communityNotFound(): ToolError {
  return new ToolError("not_found", COMMUNITY_NOT_FOUND_MESSAGE)
}

/** What the bridge's `community` operation gives for a community. */
const accountCommunitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  rules: z.array(z.object({ name: z.string(), description: z.string().nullable() })),
  member_count: nullishNumber,
  join_policy: z.string().nullish(),
  topic: z.string().nullish(),
  nsfw: z.boolean().nullish(),
  created_at: z.string().nullish(),
  is_member: z.boolean().nullish(),
})

/**
 * The community the bridge's `community` operation gave, read at `readAt`
 * (ISO 8601 UTC): its name clipped to `MAX_NAME` code points, its description
 * and each rule's description to `MAX_BIO`, each rule's name to `MAX_NAME` and
 * at most `MAX_RULES` rules kept; `clipped` names what was cut. Data off the
 * operation's shape throws `upstream_error` with `details.reason`
 * `unexpected_reply`.
 */
export function communityFromAccount(data: unknown, readAt: string): Community {
  const parsed = accountCommunitySchema.safeParse(data)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  const community = parsed.data
  const name = clipCodePoints(community.name, MAX_NAME)
  const description = clipCodePoints(community.description, MAX_BIO)
  const rules = community.rules.slice(0, MAX_RULES).map((rule) => ({
    name: clipCodePoints(rule.name, MAX_NAME),
    description: rule.description === null ? null : clipCodePoints(rule.description, MAX_BIO),
  }))
  const rulesCut =
    rules.length !== community.rules.length ||
    rules.some(
      (rule, i) => rule.name !== community.rules[i]!.name || rule.description !== community.rules[i]!.description,
    )
  const clipped: string[] = []
  if (name !== community.name) clipped.push("name")
  if (description !== community.description) clipped.push("description")
  if (rulesCut) clipped.push("rules")
  return {
    id: community.id,
    url: `https://x.com/i/communities/${community.id}`,
    name,
    description,
    rules,
    member_count: community.member_count ?? null,
    join_policy: lowercaseOrNull(community.join_policy),
    topic: community.topic ?? null,
    nsfw: community.nsfw ?? null,
    created_at: community.created_at ? isoUtc(Date.parse(community.created_at)) : null,
    is_member: community.is_member ?? null,
    read_at: readAt,
    clipped,
  }
}
