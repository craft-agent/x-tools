import { ToolError } from "../errors"
import { postReadInput, type PostMethod, type PostReadInput } from "./schemas"

type ArgumentName = keyof PostReadInput

/** The arguments every method takes. */
const SHARED_ARGUMENTS: readonly ArgumentName[] = ["method", "source", "account"]

/** The arguments every paged method takes. */
const PAGED_ARGUMENTS: readonly ArgumentName[] = ["limit", "cursor"]

/** The arguments each method takes besides the shared ones. */
const METHOD_ARGUMENTS: Readonly<Record<PostMethod, readonly ArgumentName[]>> = {
  view: ["posts"],
  search: ["query", "feed", ...PAGED_ARGUMENTS],
  quotes: ["post", ...PAGED_ARGUMENTS],
  mentions: ["handle", "since", ...PAGED_ARGUMENTS],
}

/** Every argument the schema has, in its order. */
const ARGUMENT_NAMES = Object.keys(postReadInput.shape) as ArgumentName[]

/**
 * Throws `invalid_argument` for the first argument `args` carries that its
 * method does not take, naming it and never echoing its value.
 */
export function refuseForeignArguments(args: PostReadInput): void {
  const taken = new Set([...SHARED_ARGUMENTS, ...METHOD_ARGUMENTS[args.method]])
  const foreign = ARGUMENT_NAMES.find((name) => !taken.has(name) && args[name] !== undefined)
  if (foreign !== undefined) {
    throw new ToolError("invalid_argument", `${foreign} is not an argument of ${args.method}.`)
  }
}

/** The value of the argument `name`, which its method requires: `invalid_argument` naming it when it is left out. */
export function requireArgument<Name extends ArgumentName>(
  args: PostReadInput,
  name: Name,
): NonNullable<PostReadInput[Name]> {
  const value = args[name]
  if (value === undefined || value === null) {
    throw new ToolError("invalid_argument", `${name} is required by ${args.method}.`)
  }
  return value
}
