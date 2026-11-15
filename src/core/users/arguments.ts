import { argumentRules } from "../sources/arguments"
import { userReadInput, type UserMethod, type UserReadInput } from "./schemas"

type ArgumentName = keyof UserReadInput & string

/** The arguments every list that cuts its pages to a size takes. */
const PAGED_ARGUMENTS: readonly ArgumentName[] = ["limit", "cursor"]

/** The arguments each method takes besides the shared ones. */
const METHOD_ARGUMENTS: Readonly<Record<UserMethod, readonly ArgumentName[]>> = {
  view: ["handle"],
  search: ["query", ...PAGED_ARGUMENTS],
  followers: ["handle", ...PAGED_ARGUMENTS],
  following: ["handle", ...PAGED_ARGUMENTS],
  reposters: ["post", ...PAGED_ARGUMENTS],
}

/** The argument rules of `x_user_read`'s methods: what a method refuses and what it requires. */
export const { refuseForeignArguments, requireArgument } = argumentRules<UserReadInput>({
  names: Object.keys(userReadInput.shape) as ArgumentName[],
  shared: ["method", "source", "account"],
  methods: METHOD_ARGUMENTS,
})
