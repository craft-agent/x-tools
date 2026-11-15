import { describe, expect, test } from "bun:test"
import { thrown } from "../sources/sources.testing"
import { parseHandle } from "./handle"

describe("parseHandle", () => {
  test("takes a handle with or without its @ and gives it without, as written", () => {
    expect(parseHandle("ada_writes", "handle")).toBe("ada_writes")
    expect(parseHandle("@Ada_Writes", "handle")).toBe("Ada_Writes")
    expect(parseHandle("@a", "handle")).toBe("a")
    expect(parseHandle("a_1", "handle")).toBe("a_1")
    expect(parseHandle("_", "handle")).toBe("_")
  })

  test("takes 15 characters and refuses 16", () => {
    expect(parseHandle("a".repeat(15), "handle")).toBe("a".repeat(15))
    expect(parseHandle(`@${"a".repeat(15)}`, "handle")).toBe("a".repeat(15))
    expect(thrown(() => parseHandle("a".repeat(16), "handle"))).toMatchObject({ code: "invalid_argument" })
    expect(thrown(() => parseHandle(`@${"a".repeat(16)}`, "handle"))).toMatchObject({ code: "invalid_argument" })
  })

  test("refuses what is no handle, naming the argument", () => {
    for (const input of ["", "@", "@@a", "a-b", "a b", " a", "a ", "ada@", "ada.writes", "éa", "https://x.com/ada"]) {
      const error = thrown(() => parseHandle(input, "user")) as Error
      expect(error.message.startsWith("user is not an X handle")).toBe(true)
      expect(error).toMatchObject({ code: "invalid_argument" })
    }
  })

  test("never echoes what it refuses", () => {
    expect((thrown(() => parseHandle("ada-SECRET", "handle")) as Error).message).not.toContain("SECRET")
  })
})
