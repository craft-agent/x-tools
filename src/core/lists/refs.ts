import { parseRef } from "../x/refs"

/**
 * The id of the list `input` names: an id (1 to 20 digits, whitespace around
 * it ignored) or the URL of a list on `x.com` or `twitter.com`
 * (`/i/lists/<id>`), which may carry more path after the id, a query or a
 * fragment. Anything else throws `invalid_argument` naming `argument` and
 * never echoing the input.
 */
export function parseListRef(input: string, argument = "list"): string {
  return parseRef(input, argument, { noun: "list", pathPrefix: "/i/lists/" })
}
