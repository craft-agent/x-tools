import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { readTimelineFromAccount } from "./account.timeline"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { checkSources } from "./check-sources"
import { readTimelineFromFxTwitter } from "./fxtwitter.timeline"
import { parseHandle } from "./handle"
import { DEFAULT_TAB, UNTRUSTED_NOTE, type PostReadInput, type PostReadOutput } from "./schemas"

/**
 * Reads a page of the posts of the account `args.handle` in `args.tab`
 * (`posts` by default, or `replies` or `media`), as X shows them, newest
 * first; X serves only the newest 3,200 or so posts of an account. The page
 * holds at most `args.limit` posts (20 by default); its `cursor` is null at
 * the end and continues only this handle and tab on the source that gave it.
 *
 * The sources are checked before anything is read, as `readPostList` does.
 * An account that is not there, or that no source may show, comes back with
 * its `status` and `reason`, no posts and no cursor. `invalid_argument` for an
 * argument `timeline` does not take, a missing or malformed handle, and a
 * cursor that belongs to another read, handle or tab.
 */
export async function timelineOfAccount(args: PostReadInput, reader: Reader): Promise<PostReadOutput> {
  refuseForeignArguments(args)
  const handle = parseHandle(requireArgument(args, "handle"), "handle").toLowerCase()
  const tab = args.tab ?? DEFAULT_TAB
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const page = await readPage(
    reader,
    { read: "timeline", args: { handle, tab }, source: args.source, cursor: args.cursor },
    {
      fxtwitter: (client, cursor) => readTimelineFromFxTwitter(client, handle, tab, { limit, cursor, now: reader.now }),
      account: (accountReader, cursor) =>
        readTimelineFromAccount(accountReader, handle, tab, { limit, cursor, account: args.account }),
    },
  )
  return {
    method: "timeline",
    status: page.status,
    reason: page.reason,
    results: page.items,
    source: page.source,
    cursor: page.cursor,
    note: UNTRUSTED_NOTE,
  }
}
