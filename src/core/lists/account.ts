import { ToolError } from "../errors"

/** The bridge's `list_posts` operation. */
export const LIST_POSTS_OPERATION = "list_posts"

/** The bridge's `list_members` operation. */
export const LIST_MEMBERS_OPERATION = "list_members"

/** What a list the reading account cannot see is told: X's reply for a private list is not told apart from one for a missing list. */
export const LIST_NOT_FOUND_MESSAGE =
  "X shows no such list to the reading account: it may not exist, or be private to its owner and members."

/** The error of a list the bridge gave no data for. */
export function listNotFound(): ToolError {
  return new ToolError("not_found", LIST_NOT_FOUND_MESSAGE)
}
