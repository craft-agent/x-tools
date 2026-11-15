import { z } from "zod"
import type { Reader } from "../sources/reader"
import {
  MEDIA_TYPES,
  assertPostId,
  clipPost,
  isoUtc,
  mapCounts,
  nullishCountsShape,
  nullishNumber,
  postUrl,
  readAtOf,
  unexpectedReplyError,
  type Post,
  type Quote,
  type PostLookup,
} from "./shape"

/** What the bridge's `post` operation gives for a tweet; a quote has neither `reply_to` nor `quote`. */
const accountQuoteSchema = z.object({
  id: z.string(),
  date: z.string(),
  user: z.object({ id: z.string().nullish(), username: z.string(), displayname: z.string() }),
  text: z.string(),
  lang: z.string().nullish(),
  ...nullishCountsShape,
  media: z.array(z.object({ type: z.enum(MEDIA_TYPES), url: z.string(), duration_seconds: nullishNumber })),
  links: z.array(z.string()),
  sensitive: z.boolean().nullish(),
})

const accountPostSchema = accountQuoteSchema.extend({
  reply_to: z.object({ id: z.string(), username: z.string().nullish() }).nullish(),
  quote: accountQuoteSchema.nullish(),
})

type AccountQuote = z.infer<typeof accountQuoteSchema>

function mapQuote(tweet: AccountQuote): Quote {
  const handle = tweet.user.username
  return {
    id: tweet.id,
    url: postUrl(handle, tweet.id),
    author: { id: tweet.user.id ?? null, handle, name: tweet.user.displayname },
    created_at: isoUtc(Date.parse(tweet.date)),
    text: tweet.text,
    lang: tweet.lang ?? null,
    media: tweet.media.map((item) => ({
      type: item.type,
      url: item.url,
      alt_text: null,
      width: null,
      height: null,
      duration_seconds: item.duration_seconds ?? null,
    })),
    links: tweet.links,
    counts: mapCounts(tweet),
    sensitive: tweet.sensitive ?? null,
  }
}

/**
 * The post the bridge's `post` operation gave, read at `readAt` (ISO 8601
 * UTC), in the same shape and clipping as FxTwitter's: the date normalized to
 * UTC (`…Z`), a count it did not give null, a size and an alt text it never
 * has null, and a community note that is `unknown`, since the reading account
 * does not report notes. Data off the operation's shape throws
 * `upstream_error` with `details.reason` `unexpected_reply`.
 */
export function accountPost(data: unknown, readAt: string): Post {
  const parsed = accountPostSchema.safeParse(data)
  if (!parsed.success) throw unexpectedReplyError("account", { cause: parsed.error })
  const { reply_to: replyTo, quote } = parsed.data
  return clipPost({
    ...mapQuote(parsed.data),
    reply_to: replyTo ? { id: replyTo.id, handle: replyTo.username ?? null } : null,
    quote: quote ? mapQuote(quote) : null,
    read_at: readAt,
    community_note: { status: "unknown", text: null },
  })
}

/**
 * Reads one post through the reading account `account` (the only one when left
 * out): one paced read of the bridge's `post` operation. No tweet from X is
 * `not_found`, since the reading account cannot tell a post that is gone from
 * one it may not see. Throws `invalid_argument` for an `id` that is not a
 * decimal number. The post's `read_at` is the time the reader's clock tells
 * as the bridge answers.
 */
export async function readPostFromAccount(reader: Reader, id: string, account?: string): Promise<PostLookup> {
  assertPostId(id)
  const { data } = await reader.account("post", { id }, account)
  if (data === null) return { status: "not_found", reason: "not_found" }
  return { status: "ok", post: accountPost(data, readAtOf(reader.now())) }
}
