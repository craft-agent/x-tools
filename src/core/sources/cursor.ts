import { Buffer } from "node:buffer"
import { z } from "zod"
import { ToolError } from "../errors"
import { ANSWERERS, type Answerer, type Source } from "./source"

/** The only shape of cursor this package gives. */
const CURSOR_VERSION = 1

const cursorSchema = z.strictObject({
  v: z.literal(CURSOR_VERSION),
  s: z.enum(ANSWERERS),
  r: z.string(),
  c: z.string(),
})

const SOURCE_NAMES: Readonly<Record<Answerer, string>> = { fxtwitter: "FxTwitter", account: "the reading account" }

const CONTINUES_ONLY = "a cursor continues only on the source and read that gave it"

/** What a cursor carries: the source that gave it, the read it continues and that source's own cursor. */
export type CursorParts = { source: Answerer; read: string; cursor: string }

/** What a call asks of a cursor it was given. */
export type CursorExpectation = {
  /** The read the call makes. */
  read: string
  /** The call's `source` argument. */
  source?: Source
  /** Whether the `account_only` setting is on. */
  accountOnly: boolean
}

function invalidCursor(message: string): ToolError {
  return new ToolError("invalid_argument", `${message}; ${CONTINUES_ONLY}.`)
}

/** The opaque cursor for `parts`: base64url of compact JSON. */
export function encodeCursor(parts: CursorParts): string {
  const body = { v: CURSOR_VERSION, s: parts.source, r: parts.read, c: parts.cursor }
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url")
}

/** The cursor `text` holds, as long as it is well formed; null otherwise. */
function parseCursor(text: string): z.infer<typeof cursorSchema> | null {
  // Only what `encodeCursor` writes: a lenient decoder would also take stray characters.
  const json = Buffer.from(text, "base64url")
  if (json.toString("base64url") !== text) return null
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(json.toString("utf8")))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * The source and own cursor inside `text`. A cursor continues only on the
 * source and read that gave it, so `invalid_argument` says which does not
 * hold: a malformed cursor, another read's, one of the other source when
 * `source` is explicit, and a FxTwitter one under `account_only`. With `auto`,
 * or no `source`, the cursor's own source wins.
 */
export function decodeCursor(
  text: string,
  { read, source, accountOnly }: CursorExpectation,
): { source: Answerer; cursor: string } {
  const parsed = parseCursor(text)
  if (parsed === null) throw invalidCursor("The cursor is malformed")
  if (parsed.r !== read) throw invalidCursor("The cursor belongs to another read")
  if (source !== undefined && source !== "auto" && source !== parsed.s) {
    throw invalidCursor(`The cursor came from ${SOURCE_NAMES[parsed.s]}, but source is ${source}`)
  }
  if (accountOnly && parsed.s === "fxtwitter") {
    throw invalidCursor("The cursor came from FxTwitter, which the account_only setting turns off")
  }
  return { source: parsed.s, cursor: parsed.c }
}
