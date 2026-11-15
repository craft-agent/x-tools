import { z } from "zod"
import { defineTool, type ToolSpec } from "../core"

/** A tool that shows the tool options its call got, for the tests of every entry point. */

/** The tool option the test profiles carry. */
export const NOTE_OPTION = "note_text"
export const NOTE_ID = "demo_note_stamp"

const optionValueSchema = z.union([z.string(), z.boolean(), z.number(), z.array(z.string()).readonly()])

export const STATE_ID = "demo_state_read"

/** A read tool of `alpha` that returns the state directory its call got. */
export const stateSpec: ToolSpec = defineTool({
  id: STATE_ID,
  title: STATE_ID,
  description: STATE_ID,
  toolset: "alpha",
  class: "read",
  input: z.object({}),
  output: z.object({ state_dir: z.string().optional() }),
  async execute(_args, ctx) {
    return { state_dir: ctx.stateDir }
  },
})

export const DOWNLOAD_ID = "demo_download_read"

/** A read tool of `alpha` that returns the download directory its call got. */
export const downloadSpec: ToolSpec = defineTool({
  id: DOWNLOAD_ID,
  title: DOWNLOAD_ID,
  description: DOWNLOAD_ID,
  toolset: "alpha",
  class: "read",
  input: z.object({}),
  output: z.object({ download_dir: z.string().optional() }),
  async execute(_args, ctx) {
    return { download_dir: ctx.downloadDir }
  },
})

/** An add tool of `alpha` that returns `ctx.options` and shows the note option as a fact of its description. */
export const noteSpec: ToolSpec = defineTool({
  id: NOTE_ID,
  title: NOTE_ID,
  description: NOTE_ID,
  toolset: "alpha",
  class: "add",
  targets: () => ["north"],
  describe: (_args, ctx) => ({
    facts: [{ label: "Note", value: String(ctx.options?.[NOTE_OPTION] ?? "none") }],
  }),
  input: z.object({}),
  output: z.object({ options: z.record(z.string(), optionValueSchema) }),
  async execute(_args, ctx) {
    return { options: { ...ctx.options } }
  },
})
