import { describe, expect, test } from "bun:test"
import { cookieFingerprint } from "./cookies"
import { AUTH, COOKIES, CT0, failureOf } from "./cookies.testing"

/** `TOKEN`, `CSRF` and `FINGERPRINT` of `engine/tests/support.py`: the bridge computes the same value. */
const BRIDGE_TOKEN = "tok-4f2a9c1d77"
const BRIDGE_CSRF = "csrf-9d31e8b6c0"
const BRIDGE_FINGERPRINT = "c56a17eeb423c117"

describe("cookieFingerprint", () => {
  test("is the one the bridge reports for the same token", () => {
    expect(cookieFingerprint(`auth_token=${BRIDGE_TOKEN}; ct0=${BRIDGE_CSRF}`)).toBe(BRIDGE_FINGERPRINT)
  })

  test("is 16 hex characters and follows the auth_token alone", () => {
    expect(cookieFingerprint(COOKIES)).toMatch(/^[0-9a-f]{16}$/)
    expect(cookieFingerprint(`ct0=${CT0}; auth_token=${AUTH}; other=1`)).toBe(cookieFingerprint(COOKIES))
    expect(cookieFingerprint(`auth_token="${AUTH}"; ct0=x`)).toBe(cookieFingerprint(COOKIES))
    expect(cookieFingerprint(`auth_token=${AUTH}2; ct0=${CT0}`)).not.toBe(cookieFingerprint(COOKIES))
  })

  test("is unauthenticated without an auth_token, and never names a value", async () => {
    for (const value of ["", `ct0=${CT0}`, `auth_token=; ct0=${CT0}`]) {
      const error = await failureOf(Promise.resolve().then(() => cookieFingerprint(value)))
      expect(error.code).toBe("unauthenticated")
      expect(error.message).not.toContain(CT0)
    }
  })
})
