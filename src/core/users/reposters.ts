import { accountRowsPageOf } from "../posts/account.list"
import { checkSources } from "../posts/check-sources"
import { readRowsFromFxTwitter } from "../posts/fxtwitter.list"
import { parsePostRef } from "../posts/refs"
import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { ACCOUNT_USER_ROWS } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { FX_USER_ROWS } from "./fxtwitter"
import { UNTRUSTED_NOTE, type UserReadInput, type UserReadOutput } from "./schemas"

/** The bridge's `reposters` operation. */
const REPOSTERS_OPERATION = "reposters"

/**
 * Reads the accounts that reposted the post `args.post` names (an id or a
 * URL), a page of at most `args.limit` users (20 by default) in the source's
 * order; its `cursor` is null at the end and continues only this post on the
 * source that gave it. FxTwitter reads `/2/status/<id>/reposts`, where a 404 is
 * an empty page, as for `quotes`; the reading account, one read of the bridge's
 * `reposters` operation.
 *
 * The sources are checked before anything is read, as `readPostList` does.
 * `invalid_argument` for an argument `reposters` does not take, a missing or
 * malformed post, and a cursor that belongs to another read, the cursor of the
 * quotes of the same post included.
 */
export async function repostersOfPost(args: UserReadInput, reader: Reader): Promise<UserReadOutput> {
  refuseForeignArguments(args)
  const { id } = parsePostRef(requireArgument(args, "post"), "post")
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const page = await readPage(
    reader,
    { read: "reposters", args: { post: id }, source: args.source, cursor: args.cursor },
    {
      fxtwitter: (client, cursor) =>
        readRowsFromFxTwitter(
          client,
          { path: `/2/status/${id}/reposts`, params: {} },
          { limit, cursor, now: reader.now },
          FX_USER_ROWS,
        ),
      account: async (accountReader, cursor) => {
        const { data } = await accountReader.account(REPOSTERS_OPERATION, { id, count: limit, cursor }, args.account)
        return accountRowsPageOf(data, limit, accountReader.now, ACCOUNT_USER_ROWS)
      },
    },
  )
  return { method: "reposters", results: page.items, source: page.source, cursor: page.cursor, note: UNTRUSTED_NOTE }
}
