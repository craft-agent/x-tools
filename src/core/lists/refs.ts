import { ToolError } from "../errors"
import { POST_ID_PATTERN } from "../posts/shape"

/** The hosts whose list URLs are read: X, each also under `www.` and `mobile.`. */
const LIST_HOSTS: ReadonlySet<string> = new Set(["x.com", "twitter.com"])

const HOST_PREFIX = /^(?:www\.|mobile\.)/

/** `/i/lists/<id>`; more path may follow (`/members`). */
const LIST_PATH = /^\/i\/lists\/([0-9]+)(?:\/|$)/

/** The id a list URL names, or null when it is not one. */
function parseListUrl(text: string): string | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!LIST_HOSTS.has(url.hostname.replace(HOST_PREFIX, ""))) return null
  return LIST_PATH.exec(url.pathname)?.[1] ?? null
}

/**
 * The id of the list `input` names: an id (1 to 20 digits, whitespace around
 * it ignored) or the URL of a list on `x.com` or `twitter.com`
 * (`/i/lists/<id>`), which may carry more path after the id, a query or a
 * fragment. Anything else throws `invalid_argument` naming `argument` and
 * never echoing the input.
 */
export function parseListRef(input: string, argument = "list"): string {
  const text = input.trim()
  const id = POST_ID_PATTERN.test(text) ? text : parseListUrl(text)
  if (id === null || !POST_ID_PATTERN.test(id)) {
    throw new ToolError("invalid_argument", `${argument} is not a list id or a list URL on x.com or twitter.com.`)
  }
  return id
}
