import { argumentRules } from "../sources/arguments"
import { postReadInput, type PostMethod, type PostReadInput } from "./schemas"

type ArgumentName = keyof PostReadInput & string

/** The arguments every list that cuts its pages to a size takes. */
const PAGED_ARGUMENTS: readonly ArgumentName[] = ["limit", "cursor"]

/** The arguments each method takes besides the shared ones. */
const METHOD_ARGUMENTS: Readonly<Record<PostMethod, readonly ArgumentName[]>> = {
  view: ["posts"],
  search: ["query", "feed", ...PAGED_ARGUMENTS],
  quotes: ["post", ...PAGED_ARGUMENTS],
  mentions: ["handle", "since", ...PAGED_ARGUMENTS],
  // The sources set the size of a page of replies, so there is no `limit`.
  conversation: ["post", "sort", "cursor"],
  // X gives a thread whole: no page, no `limit`, no `cursor`.
  thread: ["post"],
  timeline: ["handle", "tab", ...PAGED_ARGUMENTS],
}

/** The argument rules of `x_post_read`'s methods: what a method refuses and what it requires. */
export const { refuseForeignArguments, requireArgument } = argumentRules<PostReadInput>({
  names: Object.keys(postReadInput.shape) as ArgumentName[],
  shared: ["method", "source", "account"],
  methods: METHOD_ARGUMENTS,
})
