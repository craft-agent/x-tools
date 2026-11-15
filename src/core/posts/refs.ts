import { ToolError } from "../errors"
import { POST_ID_PATTERN } from "./shape"

/** A post a caller named: its id, and the handle its URL gave (null for an id, or a URL that names none). */
export type PostRef = { id: string; handle: string | null }

/** A post reference as the caller gave it, with the post it names. */
export type NamedPostRef = PostRef & { input: string }

/** The hosts whose post URLs are read: X and the FxTwitter mirrors, each also under `www.` and `mobile.`. */
const POST_HOSTS: ReadonlySet<string> = new Set([
  "x.com",
  "twitter.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
  "fixvx.com",
])

const HOST_PREFIX = /^(?:www\.|mobile\.)/

/** `/i/status/<id>` and `/i/web/status/<id>`, which name no author; more path may follow. */
const ANONYMOUS_PATH = /^\/i\/(?:web\/)?status\/([0-9]+)(?:\/|$)/

/** `/<handle>/status/<id>` and `/<handle>/statuses/<id>`; more path may follow. */
const HANDLE_PATH = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/([0-9]+)(?:\/|$)/

function invalidReference(argument: string): ToolError {
  return new ToolError(
    "invalid_argument",
    `${argument} is not a post id or a post URL on x.com, twitter.com or an FxTwitter mirror.`,
  )
}

/** The id and handle a post URL names, or null when it is not one. */
function parsePostUrl(text: string): PostRef | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!POST_HOSTS.has(url.hostname.replace(HOST_PREFIX, ""))) return null

  const anonymous = ANONYMOUS_PATH.exec(url.pathname)
  if (anonymous) return { id: anonymous[1]!, handle: null }
  const named = HANDLE_PATH.exec(url.pathname)
  return named ? { id: named[2]!, handle: named[1]! } : null
}

/**
 * The post `input` names: an id (1 to 20 digits, whitespace around it
 * ignored) or the URL of a post on `x.com`, `twitter.com` or one of the
 * FxTwitter mirrors, which may carry a path after the id (`/photo/1`), a query
 * or a fragment. Anything else throws `invalid_argument` naming the argument
 * and never echoing the input: `posts[position]` for a position in `posts`, or
 * the name of the argument given instead.
 */
export function parsePostRef(input: string, at: number | string = 0): PostRef {
  const text = input.trim()
  const ref = POST_ID_PATTERN.test(text) ? { id: text, handle: null } : parsePostUrl(text)
  if (!ref || !POST_ID_PATTERN.test(ref.id)) throw invalidReference(typeof at === "number" ? `posts[${at}]` : at)
  return ref
}

/**
 * Every entry of `inputs` parsed, in order, before any is read; a post named
 * more than once (the same id) is kept at its first place only.
 */
export function parsePostRefs(inputs: readonly string[]): NamedPostRef[] {
  const refs = inputs.map((input, position) => ({ input, ...parsePostRef(input, position) }))
  const seen = new Set<string>()
  return refs.filter((ref) => {
    if (seen.has(ref.id)) return false
    seen.add(ref.id)
    return true
  })
}
