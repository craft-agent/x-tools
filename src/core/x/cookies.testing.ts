import { isToolError, type ToolError } from "../errors"

/** Fixtures the cookie and engine call tests share: made-up cookies, and the `ToolError` a call rejects with. */

/** A made-up `auth_token` value. */
export const AUTH = "authsecret0123456789"

/** A made-up `ct0` value. */
export const CT0 = "ctzerosecret9876543210"

/** The cookie string of `AUTH` and `CT0`. */
export const COOKIES = `auth_token=${AUTH}; ct0=${CT0}`

/** The `ToolError` `promise` rejects with; any other outcome fails the test. */
export async function failureOf(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise
  } catch (error) {
    if (isToolError(error)) return error
    throw error
  }
  throw new Error("expected a ToolError")
}
