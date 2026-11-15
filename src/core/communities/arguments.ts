import { argumentRules } from "../sources/arguments"
import { communityReadInput, type CommunityMethod, type CommunityReadInput } from "./schemas"

type ArgumentName = keyof CommunityReadInput & string

/** The arguments each method takes besides the shared ones: `view` reads one community, the others a page of it, `posts` in an order. */
const METHOD_ARGUMENTS: Readonly<Record<CommunityMethod, readonly ArgumentName[]>> = {
  view: ["community"],
  posts: ["community", "order", "limit", "cursor"],
  members: ["community", "limit", "cursor"],
}

/** The argument rules of `x_community_read`'s methods: what a method refuses and what it requires. */
export const { refuseForeignArguments, requireArgument } = argumentRules<CommunityReadInput>({
  names: Object.keys(communityReadInput.shape) as ArgumentName[],
  shared: ["method", "source", "account"],
  methods: METHOD_ARGUMENTS,
})
