import { z } from "zod"
import type { LabelPaths } from "./labels"
import { DAY_MS } from "./pacing"
import { readJsonFile, writePrivateFile } from "./private-file"

/** How long a remembered user id is used: a handle can change hands, so an entry expires. */
export const USER_ID_TTL_MS = 7 * DAY_MS

/** The most handles a label remembers; the oldest entry is dropped first. */
export const MAX_USER_IDS = 200

/** A user id: decimal digits only, as X's ids are. */
export const USER_ID_PATTERN = /^[0-9]{1,20}$/

/** The version of the file's format. */
const FILE_VERSION = 1

const fileSchema = z.object({
  v: z.literal(FILE_VERSION),
  ids: z.record(z.string(), z.object({ id: z.string().regex(USER_ID_PATTERN), at: z.number().finite() })),
})

type UserIds = z.infer<typeof fileSchema>["ids"]

/** The remembered ids; a missing, unreadable or malformed file is empty, never an error. */
async function readUserIds(paths: LabelPaths): Promise<UserIds> {
  const parsed = fileSchema.safeParse(await readJsonFile(paths.userIds))
  return parsed.success ? parsed.data.ids : {}
}

/** The id remembered for `handle` (any case) when it is less than `USER_ID_TTL_MS` old at `now`, else null. */
export async function readUserId(paths: LabelPaths, handle: string, now: number): Promise<string | null> {
  const entry = (await readUserIds(paths))[handle.toLowerCase()]
  return entry !== undefined && entry.at <= now && now - entry.at < USER_ID_TTL_MS ? entry.id : null
}

/**
 * Remembers that `handle` (any case) was user `id` at `now`, as a private file
 * beside the label's other state. The oldest entries are dropped past
 * `MAX_USER_IDS`, never the one just written. There is no lock: of two writers
 * at once the last wins, which only loses an entry. This is a cache, so a
 * write that fails is ignored.
 */
export async function writeUserId(paths: LabelPaths, handle: string, id: string, now: number): Promise<void> {
  try {
    const key = handle.toLowerCase()
    const { [key]: _replaced, ...others } = await readUserIds(paths)
    const kept = Object.entries(others)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_USER_IDS - 1)
    const ids: UserIds = { ...Object.fromEntries(kept), [key]: { id, at: now } }
    await writePrivateFile(paths.userIds, `${JSON.stringify({ v: FILE_VERSION, ids })}\n`)
  } catch {
    // A cache: the next read asks X again.
  }
}
