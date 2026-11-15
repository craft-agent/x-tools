import { ToolError } from "../errors"

/** The longest handle X gives out, without the "@". */
const MAX_HANDLE_LENGTH = 15

/** The most characters of a `handle` argument: a handle and its "@". */
export const MAX_HANDLE_INPUT_LENGTH = MAX_HANDLE_LENGTH + 1

const HANDLE_PATTERN = new RegExp(`^@?([A-Za-z0-9_]{1,${MAX_HANDLE_LENGTH}})$`)

/**
 * The handle `input` names, without its "@" and as written: an optional
 * leading "@", then 1 to 15 letters, digits or underscores. Anything else
 * throws `invalid_argument` naming `argName` and never echoing the input.
 */
export function parseHandle(input: string, argName: string): string {
  const match = HANDLE_PATTERN.exec(input)
  if (!match) {
    throw new ToolError(
      "invalid_argument",
      `${argName} is not an X handle: 1 to ${MAX_HANDLE_LENGTH} letters, digits or underscores, with or without a leading "@".`,
    )
  }
  return match[1]!
}
