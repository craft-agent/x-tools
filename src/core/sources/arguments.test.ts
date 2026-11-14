import { describe, expect, test } from "bun:test"
import { thrown } from "./sources.testing"
import { argumentRules } from "./arguments"

type Input = { method: "list" | "show"; id?: string; page?: number; source?: string }

const { refuseForeignArguments, requireArgument } = argumentRules<Input>({
  names: ["method", "id", "page", "source"],
  shared: ["method", "source"],
  methods: { list: ["page"], show: ["id"] },
})

describe("the argument rules of a read tool", () => {
  test("a method refuses an argument another method takes, naming it and never its value", () => {
    const error = thrown(() => refuseForeignArguments({ method: "list", id: "SECRET" }))
    expect(error).toMatchObject({ code: "invalid_argument", message: "id is not an argument of list." })
    expect((error as Error).message).not.toContain("SECRET")
  })

  test("a method takes its own arguments and the shared ones, and an argument left out is no argument", () => {
    expect(thrown(() => refuseForeignArguments({ method: "list", page: 2, source: "auto" }))).toBeUndefined()
    expect(thrown(() => refuseForeignArguments({ method: "show", id: "7", page: undefined }))).toBeUndefined()
  })

  test("an argument a method requires is returned, and named when it is left out", () => {
    expect(requireArgument({ method: "show", id: "7" }, "id")).toBe("7")
    expect(thrown(() => requireArgument({ method: "show" }, "id"))).toMatchObject({
      code: "invalid_argument",
      message: "id is required by show.",
    })
  })
})
