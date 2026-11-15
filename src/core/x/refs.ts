import { ToolError } from "../errors"
import { POST_ID_PATTERN } from "../posts/shape"

/** The hosts whose URLs are read: X, each also under `www.` and `mobile.`. */
const X_HOSTS: ReadonlySet<string> = new Set(["x.com", "twitter.com"])

const HOST_PREFIX = /^(?:www\.|mobile\.)/

/** What a kind of X page is called, and where its URL keeps its id. */
export type RefKind = {
  /** What the page is, as the refusal names it: `list`. */
  noun: string
  /** The path before the id: `/i/lists/`. */
  pathPrefix: string
}

/** The id the URL `text` names under `kind`'s path, or null when it is not one; more path may follow the id. */
function parseRefUrl(text: string, kind: RefKind): string | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!X_HOSTS.has(url.hostname.replace(HOST_PREFIX, ""))) return null
  if (!url.pathname.startsWith(kind.pathPrefix)) return null
  return /^([0-9]+)(?:\/|$)/.exec(url.pathname.slice(kind.pathPrefix.length))?.[1] ?? null
}

/**
 * The id of the page of `kind` that `input` names: an id (1 to 20 digits,
 * whitespace around it ignored) or the URL of such a page on `x.com` or
 * `twitter.com`, which may carry more path after the id, a query or a
 * fragment. Anything else throws `invalid_argument` naming `argument` and
 * never echoing the input.
 */
export function parseRef(input: string, argument: string, kind: RefKind): string {
  const text = input.trim()
  const id = POST_ID_PATTERN.test(text) ? text : parseRefUrl(text, kind)
  if (id === null || !POST_ID_PATTERN.test(id)) {
    throw new ToolError(
      "invalid_argument",
      `${argument} is not a ${kind.noun} id or a ${kind.noun} URL on x.com or twitter.com.`,
    )
  }
  return id
}
