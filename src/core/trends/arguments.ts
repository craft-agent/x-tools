import { argumentRules } from "../sources/arguments"
import { trendReadInput, type TrendMethod, type TrendReadInput } from "./schemas"

type ArgumentName = keyof TrendReadInput & string

/** The arguments each method takes besides the shared ones: `explore` reads a page of one category. */
const METHOD_ARGUMENTS: Readonly<Record<TrendMethod, readonly ArgumentName[]>> = {
  explore: ["category", "limit", "cursor"],
}

/** The argument rules of `x_trend_read`'s methods: what a method refuses. */
export const { refuseForeignArguments } = argumentRules<TrendReadInput>({
  names: Object.keys(trendReadInput.shape) as ArgumentName[],
  shared: ["method", "source", "account"],
  methods: METHOD_ARGUMENTS,
})
