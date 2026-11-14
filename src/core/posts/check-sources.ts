import { ToolError } from "../errors"
import { ACCOUNT_ONLY_MESSAGE } from "../sources/choose"
import type { Reader } from "../sources/reader"
import { NO_ACCOUNT_MESSAGE } from "../x/labels"
import type { PostReadInput } from "./schemas"

/**
 * Throws what a call that can only read the reading account is told when none
 * is set up, or when FxTwitter is pinned but turned off; and, when the call
 * names a reading account, what a read of it would be told, so a mistyped
 * label fails even when FxTwitter answers every post.
 */
export async function checkSources(args: Pick<PostReadInput, "source" | "account">, reader: Reader): Promise<void> {
  if (args.source === "fxtwitter" && reader.accountOnly) {
    throw new ToolError("invalid_argument", ACCOUNT_ONLY_MESSAGE)
  }
  const accountOnly = args.source === "account" || reader.accountOnly
  if (accountOnly && !(await reader.hasAccount())) {
    throw new ToolError("not_found", NO_ACCOUNT_MESSAGE, { details: { known_accounts: [] } })
  }
  if (args.account !== undefined) await reader.checkAccount(args.account)
}
