import { ToolError, isToolError } from "../errors"
import { ACCOUNT_ONLY_MESSAGE, readFromSources } from "../sources/choose"
import type { Reader } from "../sources/reader"
import type { Answerer } from "../sources/source"
import { NO_ACCOUNT_MESSAGE } from "../x/labels"
import { readPostFromAccount } from "./account"
import { readPostFromFxTwitter } from "./fxtwitter"
import { parsePostRefs, type NamedPostRef } from "./refs"
import { UNTRUSTED_NOTE, type PostItem, type PostReadInput, type PostReadOutput } from "./schemas"
import type { PostLookup } from "./shape"

/** The item of a post a source answered. */
function answeredItem(ref: NamedPostRef, lookup: PostLookup, source: Answerer): PostItem {
  const handleMismatch =
    lookup.status === "ok" &&
    ref.handle !== null &&
    ref.handle.toLowerCase() !== lookup.post.author.handle.toLowerCase()
  return {
    input: ref.input,
    id: ref.id,
    url_handle: ref.handle,
    handle_mismatch: handleMismatch,
    status: lookup.status,
    source,
    reason: lookup.status === "ok" ? null : lookup.reason,
    retry_at: null,
    error: null,
    post: lookup.status === "ok" ? lookup.post : null,
  }
}

/** The item of a post no source answered: why, when to ask again if the failure says, and the failure itself. */
function notReadItem(ref: NamedPostRef, error: ToolError): PostItem {
  const reason = error.details?.reason
  const retryAt = error.details?.retry_at
  return {
    input: ref.input,
    id: ref.id,
    url_handle: ref.handle,
    handle_mismatch: false,
    status: "not_read",
    source: null,
    reason: typeof reason === "string" ? reason : error.code,
    retry_at: typeof retryAt === "string" ? retryAt : null,
    error: `${error.code}: ${error.message}`,
    post: null,
  }
}

/**
 * Throws what a call that can only read the reading account is told when none
 * is set up, or when FxTwitter is pinned but turned off; and, when the call
 * names a reading account, what a read of it would be told, so a mistyped
 * label fails even when FxTwitter answers every post.
 */
async function checkSources(args: PostReadInput, reader: Reader): Promise<void> {
  if (args.source === "fxtwitter" && reader.accountOnly) {
    throw new ToolError("invalid_argument", ACCOUNT_ONLY_MESSAGE)
  }
  const accountOnly = args.source === "account" || reader.accountOnly
  if (accountOnly && !(await reader.hasAccount())) {
    throw new ToolError("not_found", NO_ACCOUNT_MESSAGE, { details: { known_accounts: [] } })
  }
  if (args.account !== undefined) await reader.checkAccount(args.account)
}

/**
 * Reads the posts of `args.posts` one after another, in order and each once,
 * on the source the call chose, FxTwitter first under `auto`.
 *
 * Every reference is parsed, and the sources checked (`invalid_argument` for
 * `source: fxtwitter` under `account_only`, `not_found` for a read that needs
 * the reading account when none is set up), before anything is read. A
 * `ToolError` while reading one post leaves that post `not_read` with the
 * failure's `reason`, `retry_at` and `error`, and the call goes on; the call's
 * budget, the caps and a failing FxTwitter end up there. An abort and an
 * `internal_error` end the call.
 */
export async function viewPosts(args: PostReadInput, reader: Reader): Promise<PostReadOutput> {
  const refs = parsePostRefs(args.posts)
  await checkSources(args, reader)

  const posts: PostItem[] = []
  for (const ref of refs) {
    try {
      const { source, value } = await readFromSources(reader, args.source, {
        fxtwitter: (client) => readPostFromFxTwitter(client, ref.id),
        account: (accountReader) => readPostFromAccount(accountReader, ref.id, args.account),
      })
      posts.push(answeredItem(ref, value, source))
    } catch (error) {
      if (!isToolError(error) || error.code === "internal_error") throw error
      posts.push(notReadItem(ref, error))
    }
  }
  return { posts, note: UNTRUSTED_NOTE }
}
