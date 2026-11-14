import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { z } from "zod"
import { ToolError } from "../errors"
import { ANSWERERS, type Answerer, type Source } from "./source"

/** The only shape of cursor this package gives. */
const CURSOR_VERSION = 1

/** The characters of an arguments digest a cursor keeps: 22 base64url characters are 132 bits. */
const ARGS_DIGEST_LENGTH = 22

const cursorSchema = z.strictObject({
  v: z.literal(CURSOR_VERSION),
  s: z.enum(ANSWERERS),
  r: z.string(),
  a: z.string(),
  c: z.string(),
})

const SOURCE_NAMES: Readonly<Record<Answerer, string>> = { fxtwitter: "FxTwitter", account: "the reading account" }

const CONTINUES_ONLY = "a cursor continues only on the source, read and arguments that gave it"

/** The arguments that decide what a read reads (its query, handle, post id or tab), never `limit`, `source`, `account` or `cursor`. */
type ReadArgs = Readonly<Record<string, unknown>>

/** What a cursor carries: the source that gave it, the read and arguments it continues and that source's own cursor. */
export type CursorParts = { source: Answerer; read: string; args: ReadArgs; cursor: string }

/** What a call asks of a cursor it was given. */
export type CursorExpectation = {
  /** The read the call makes. */
  read: string
  /** The arguments that decide what the call reads. */
  args: ReadArgs
  /** The call's `source` argument. */
  source?: Source
  /** Whether the `account_only` setting is on. */
  accountOnly: boolean
}

function invalidCursor(message: string): ToolError {
  return new ToolError("invalid_argument", `${message}; ${CONTINUES_ONLY}.`)
}

/** `value` with the keys of every object sorted, so that equal arguments write the same JSON in any key order. */
function sortKeys(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** A digest of `args`: SHA-256 of its canonical JSON (keys sorted at every depth, `undefined` values dropped). */
function argsDigest(args: ReadArgs): string {
  const json = JSON.stringify(args, sortKeys)
  return createHash("sha256").update(json, "utf8").digest("base64url").slice(0, ARGS_DIGEST_LENGTH)
}

/** The opaque cursor for `parts`: base64url of compact JSON. */
export function encodeCursor(parts: CursorParts): string {
  const body = { v: CURSOR_VERSION, s: parts.source, r: parts.read, a: argsDigest(parts.args), c: parts.cursor }
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
 * source, read and arguments that gave it, so `invalid_argument` says which
 * does not hold: a malformed cursor, another read's, the same read's with
 * other arguments, one of the other source when `source` is explicit, and a
 * FxTwitter one under `account_only`. With `auto`, or no `source`, the
 * cursor's own source wins.
 */
export function decodeCursor(
  text: string,
  { read, args, source, accountOnly }: CursorExpectation,
): { source: Answerer; cursor: string } {
  const parsed = parseCursor(text)
  if (parsed === null) throw invalidCursor("The cursor is malformed")
  if (parsed.r !== read) throw invalidCursor("The cursor belongs to another read")
  if (parsed.a !== argsDigest(args)) {
    throw invalidCursor("The cursor belongs to the same read with other arguments")
  }
  if (source !== undefined && source !== "auto" && source !== parsed.s) {
    throw invalidCursor(`The cursor came from ${SOURCE_NAMES[parsed.s]}, but source is ${source}`)
  }
  if (accountOnly && parsed.s === "fxtwitter") {
    throw invalidCursor("The cursor came from FxTwitter, which the account_only setting turns off")
  }
  return { source: parsed.s, cursor: parsed.c }
}
