import { describe, expect, test } from "bun:test"
import { hasCookiePair, maskCookies } from "./cookies"
import { AUTH, COOKIES, CT0 } from "./cookies.testing"

describe("hasCookiePair", () => {
  test("needs auth_token and ct0, each with a value", () => {
    expect(hasCookiePair("auth_token=a1; ct0=b2")).toBe(true)
    expect(hasCookiePair("ct0=b2; auth_token=a1")).toBe(true)
    expect(hasCookiePair("auth_token=a1")).toBe(false)
    expect(hasCookiePair("ct0=b2")).toBe(false)
    expect(hasCookiePair("")).toBe(false)
  })

  test("takes spaces around names, values and separators", () => {
    expect(hasCookiePair("  auth_token = a1 ;ct0=  b2  ;")).toBe(true)
    expect(hasCookiePair("auth_token=a1;ct0=b2")).toBe(true)
  })

  test("takes further cookies, and values with an equals sign", () => {
    expect(hasCookiePair("guest_id=v1%3A1; auth_token=a1; kdt=x; ct0=b2==")).toBe(true)
  })

  test("takes a quoted value, but not a quoted nothing", () => {
    expect(hasCookiePair('auth_token="a1"; ct0="b2"')).toBe(true)
    expect(hasCookiePair('auth_token=""; ct0=b2')).toBe(false)
  })

  test("rejects empty values and a name alone", () => {
    expect(hasCookiePair("auth_token=; ct0=b2")).toBe(false)
    expect(hasCookiePair("auth_token=a1; ct0=")).toBe(false)
    expect(hasCookiePair("auth_token=a1; ct0")).toBe(false)
    expect(hasCookiePair("auth_token=")).toBe(false)
    expect(hasCookiePair("auth_token=   ; ct0=b2")).toBe(false)
  })

  test("names are exact: a lookalike does not count", () => {
    expect(hasCookiePair("xauth_token=a1; ct0=b2")).toBe(false)
    expect(hasCookiePair("AUTH_TOKEN=a1; ct0=b2")).toBe(false)
  })
})

describe("maskCookies", () => {
  test("replaces the whole string, then each value", () => {
    expect(maskCookies(`got ${COOKIES} back`, COOKIES)).toBe("got [masked] back")
    expect(maskCookies(`auth ${AUTH} and ${CT0}`, COOKIES)).toBe("auth [masked] and [masked]")
  })

  test("replaces every occurrence", () => {
    expect(maskCookies(`${AUTH} ${AUTH} ${CT0} ${COOKIES}`, COOKIES)).toBe("[masked] [masked] [masked] [masked]")
  })

  test("masks a value that holds another, longest first, leaving no remainder", () => {
    const cookies = "auth_token=abcdefghij; ct0=abcdefghijKLMNOP"
    expect(maskCookies("x abcdefghijKLMNOP y abcdefghij", cookies)).toBe("x [masked] y [masked]")
  })

  test("masks a value shorter than 8 characters", () => {
    expect(maskCookies("token a1 and b2", "auth_token=a1; ct0=b2")).toBe("token [masked] and [masked]")
  })

  test("masks the inside of a quoted value and the whole quoted string", () => {
    const cookies = 'auth_token="a1b2c3d4e5"; ct0="f6g7h8i9j0"'
    expect(maskCookies("a1b2c3d4e5 f6g7h8i9j0", cookies)).toBe("[masked] [masked]")
    expect(maskCookies(`in ${cookies}`, cookies)).toBe("in [masked]")
  })

  test("leaves a text without the cookies as it is, and masks nothing for empty cookies", () => {
    expect(maskCookies("nothing here", COOKIES)).toBe("nothing here")
    expect(maskCookies("nothing here", "")).toBe("nothing here")
  })
})
