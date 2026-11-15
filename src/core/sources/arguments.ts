import { ToolError } from "../errors"

/** What a read tool tells the argument rules about its methods: its input's argument names, those every method takes, and those each method takes besides. */
export type MethodArguments<Input extends { method: string }> = {
  /** Every argument the input schema has. */
  names: readonly ArgumentName<Input>[]
  /** The arguments every method takes. */
  shared: readonly ArgumentName<Input>[]
  /** The arguments each method takes besides the shared ones. */
  methods: Readonly<Record<Input["method"], readonly ArgumentName<Input>[]>>
}

/** The rules a read tool's methods apply to their arguments. */
export type ArgumentRules<Input extends { method: string }> = {
  /**
   * Throws `invalid_argument` for the first argument `args` carries that its
   * method does not take, naming it and never echoing its value.
   */
  refuseForeignArguments(args: Input): void
  /** The value of the argument `name`, which its method requires: `invalid_argument` naming it when it is left out. */
  requireArgument<Name extends ArgumentName<Input>>(args: Input, name: Name): NonNullable<Input[Name]>
}

type ArgumentName<Input> = Extract<keyof Input, string>

/** The argument rules of a read tool whose methods take the arguments `spec` lists. */
export function argumentRules<Input extends { method: string }>(spec: MethodArguments<Input>): ArgumentRules<Input> {
  return {
    refuseForeignArguments(args) {
      const taken = new Set([...spec.shared, ...spec.methods[args.method as Input["method"]]])
      const foreign = spec.names.find((name) => !taken.has(name) && args[name] !== undefined)
      if (foreign !== undefined) {
        throw new ToolError("invalid_argument", `${foreign} is not an argument of ${args.method}.`)
      }
    },
    requireArgument(args, name) {
      const value = args[name]
      if (value === undefined || value === null) {
        throw new ToolError("invalid_argument", `${name} is required by ${args.method}.`)
      }
      return value
    },
  }
}
