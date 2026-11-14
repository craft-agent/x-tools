import { z } from "zod"
import type { ToolOptions } from "../tool"

/** The sources that can answer a read. */
export const ANSWERERS = ["fxtwitter", "account"] as const

/** The values of a read's `source` argument. */
export const SOURCES = ["auto", ...ANSWERERS] as const

/** Which source a read may use: `auto` lets the choice pick one. */
export type Source = (typeof SOURCES)[number]

/** The source that answered a read. */
export type Answerer = (typeof ANSWERERS)[number]

/** The `source` argument of every read that has two sources. */
export const sourceArgument = z
  .enum(SOURCES)
  .optional()
  .describe(
    "Which source reads. `auto` (the default) reads FxTwitter first and the reading account only when FxTwitter cannot answer; " +
      "`fxtwitter` reads only FxTwitter, a third party that reads X itself; " +
      "`account` reads only the reading account, X's own answer, spending its reads.",
  )

/** Whether the `account_only` setting turns FxTwitter off; true only for `true`. */
export function accountOnly(options?: ToolOptions): boolean {
  return options?.account_only === true
}
