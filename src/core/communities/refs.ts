import { parseRef } from "../x/refs"

/**
 * The id of the community `input` names: an id (1 to 20 digits, whitespace
 * around it ignored) or the URL of a community on `x.com` or `twitter.com`
 * (`/i/communities/<id>`), which may carry more path after the id, a query or
 * a fragment. Anything else throws `invalid_argument` naming `argument` and
 * never echoing the input.
 */
export function parseCommunityRef(input: string, argument = "community"): string {
  return parseRef(input, argument, { noun: "community", pathPrefix: "/i/communities/" })
}
