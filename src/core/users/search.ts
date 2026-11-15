import { ToolError } from "../errors"
import { checkSources } from "../posts/check-sources"
import { DEFAULT_LIMIT, readPage } from "../sources/page"
import type { Reader } from "../sources/reader"
import { readUsersFromAccount } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { readUsersFromFxTwitter } from "./fxtwitter"
import { UNTRUSTED_NOTE, type UserReadInput, type UserReadOutput } from "./schemas"

/**
 * Searches users for `args.query`, the words passed as written, a page of at
 * most `args.limit` users (20 by default) in the source's order; its `cursor`
 * is null at the end and continues only this query on the source that gave it.
 *
 * The sources are checked before anything is read, as `readPostList` does.
 * `invalid_argument` for an argument `search` does not take, a missing or
 * blank query, and a cursor that belongs to another read, including the
 * cursor of a search of posts.
 */
export async function searchUsers(args: UserReadInput, reader: Reader): Promise<UserReadOutput> {
  refuseForeignArguments(args)
  const query = requireArgument(args, "query")
  if (query.trim() === "") throw new ToolError("invalid_argument", "query must not be empty.")
  await checkSources(args, reader)
  const limit = args.limit ?? DEFAULT_LIMIT
  const page = await readPage(
    reader,
    { read: "user_search", args: { query }, source: args.source, cursor: args.cursor },
    {
      fxtwitter: (client, cursor) => readUsersFromFxTwitter(client, query, { limit, cursor, now: reader.now }),
      account: (accountReader, cursor) =>
        readUsersFromAccount(accountReader, query, { limit, cursor, account: args.account }),
    },
  )
  return { method: "search", results: page.items, source: page.source, cursor: page.cursor, note: UNTRUSTED_NOTE }
}
