/** The identity and environment an entry point supplies to a tool beside the call's own context. */
export type ToolRuntime = {
  /** The prefix of the package's variables, such as the one a reading account's cookies are read from. */
  envPrefix: string
  /** The command line a person runs, as a recovery command names it. */
  cli: string
  /** The environment a tool reads its variables from. */
  env: Readonly<Record<string, string | undefined>>
  /** The clock in epoch milliseconds. */
  now: () => number
}
