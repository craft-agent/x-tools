import { checkSources } from "../posts/check-sources"
import { readAtOf } from "../posts/shape"
import { readFromSources } from "../sources/choose"
import type { Reader } from "../sources/reader"
import { COMMUNITY_OPERATION, communityFromAccount, communityNotFound } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { parseCommunityRef } from "./refs"
import { UNTRUSTED_NOTE, type CommunityReadInput, type CommunityReadOutput } from "./schemas"

/**
 * Reads the community `args.community` names (an id or a URL): its name,
 * description, rules, size and whether the reading account is a member, as
 * the reading account sees it. FxTwitter has no community route, so
 * `source: fxtwitter` is refused and `auto` reads the account: one read of
 * the bridge's `community` operation.
 *
 * The sources are checked before anything is read, as `viewUser` does.
 * `invalid_argument` for an argument `view` does not take and a missing or
 * malformed community; `not_found` for a community X gives no data for.
 */
export async function viewCommunity(args: CommunityReadInput, reader: Reader): Promise<CommunityReadOutput> {
  refuseForeignArguments(args)
  const id = parseCommunityRef(requireArgument(args, "community"), "community")
  await checkSources(args, reader)
  const { source, value } = await readFromSources(reader, args.source, {
    account: async (accountReader) => {
      const { data } = await accountReader.account(COMMUNITY_OPERATION, { id }, args.account)
      if (data === null) throw communityNotFound()
      return communityFromAccount(data, readAtOf(accountReader.now()))
    },
  })
  return { method: "view", community: value, source, note: UNTRUSTED_NOTE }
}
