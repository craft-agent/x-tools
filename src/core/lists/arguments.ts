import { argumentRules } from "../sources/arguments"
import { listReadInput, type ListMethod, type ListReadInput } from "./schemas"

type ArgumentName = keyof ListReadInput & string

/** The arguments each method takes besides the shared ones: both read a page of one list. */
const METHOD_ARGUMENTS: Readonly<Record<ListMethod, readonly ArgumentName[]>> = {
  posts: ["list", "limit", "cursor"],
  members: ["list", "limit", "cursor"],
}

/** The argument rules of `x_list_read`'s methods: what a method refuses and what it requires. */
export const { refuseForeignArguments, requireArgument } = argumentRules<ListReadInput>({
  names: Object.keys(listReadInput.shape) as ArgumentName[],
  shared: ["method", "source", "account"],
  methods: METHOD_ARGUMENTS,
})
