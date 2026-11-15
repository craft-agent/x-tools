import { checkSources } from "../posts/check-sources"
import { parseHandle } from "../posts/handle"
import { readFromSources } from "../sources/choose"
import type { Reader } from "../sources/reader"
import { readUserFromAccount } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { readUserFromFxTwitter } from "./fxtwitter"
import { UNTRUSTED_NOTE, type UserReadInput, type UserReadOutput } from "./schemas"

/**
 * Reads the profile of the account `args.handle` (with or without `@`, read
 * in lower case), on the source the call chose, FxTwitter first under `auto`.
 * An account that is not there, or that no source may show, comes back with
 * its `status` and `reason` and no user; from the reading account it is also
 * remembered by user id, so a later `timeline` through it takes one read.
 *
 * The sources are checked before anything is read, as `timelineOfAccount` does;
 * `invalid_argument` for an argument `view` does not take and a missing or
 * malformed handle.
 */
export async function viewUser(args: UserReadInput, reader: Reader): Promise<UserReadOutput> {
  refuseForeignArguments(args)
  const handle = parseHandle(requireArgument(args, "handle"), "handle").toLowerCase()
  await checkSources(args, reader)
  const { source, value } = await readFromSources(reader, args.source, {
    fxtwitter: (client) => readUserFromFxTwitter(client, handle, reader.now),
    account: (accountReader) => readUserFromAccount(accountReader, handle, args.account),
  })
  return {
    method: "view",
    status: value.status,
    reason: value.status === "ok" ? null : value.reason,
    user: value.status === "ok" ? value.user : null,
    source,
    note: UNTRUSTED_NOTE,
  }
}
