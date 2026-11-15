import { ToolError, isToolError } from "../errors"
import { readFromSources } from "../sources/choose"
import type { Reader } from "../sources/reader"
import type { Answerer } from "../sources/source"
import { readPostFromAccount } from "./account"
import { refuseForeignArguments, requireArgument } from "./arguments"
import { checkSources } from "./check-sources"
import { readPostFromFxTwitter } from "./fxtwitter"
import { parsePostRefs, type NamedPostRef } from "./refs"
import { UNTRUSTED_NOTE, type PostItem, type PostReadInput, type PostViewOutput } from "./schemas"
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
 * Reads the posts of `args.posts` one after another, in order and each once,
 * on the source the call chose, FxTwitter first under `auto`.
 *
 * The arguments are checked (`invalid_argument` for one `view` does not take
 * or lacks), every reference is parsed, and the sources checked
 * (`invalid_argument` for `source: fxtwitter` under `account_only`,
 * `not_found` for a read that needs the reading account when none is set up),
 * before anything is read. A `ToolError` while reading one post leaves that
 * post `not_read` with the failure's `reason`, `retry_at` and `error`, and the
 * call goes on; the call's budget, the caps and a failing FxTwitter end up
 * there. An abort and an `internal_error` end the call.
 */
export async function viewPosts(args: PostReadInput, reader: Reader): Promise<PostViewOutput> {
  refuseForeignArguments(args)
  const refs = parsePostRefs(requireArgument(args, "posts"))
  await checkSources(args, reader)

  const posts: PostItem[] = []
  for (const ref of refs) {
    try {
      const { source, value } = await readFromSources(reader, args.source, {
        fxtwitter: (client) => readPostFromFxTwitter(client, ref.id, reader.now),
        account: (accountReader) => readPostFromAccount(accountReader, ref.id, args.account),
      })
      posts.push(answeredItem(ref, value, source))
    } catch (error) {
      if (!isToolError(error) || error.code === "internal_error") throw error
      posts.push(notReadItem(ref, error))
    }
  }
  return { method: "view", posts, note: UNTRUSTED_NOTE }
}
