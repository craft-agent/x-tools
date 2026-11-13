import { z } from "zod"
import type { CookieSource } from "../x/cookies"
import type { EngineState } from "../x/engine"

/** What a label's cookies are like, as far as its variable or file tells. */
export type CookieStatus = "available" | "missing" | "invalid" | "unreadable"

/** The next steps an account can need, in the order of their priority. */
export const ACTIONS = ["engine_install", "login", "wait"] as const

export const accountReadInput = z.object({
  account: z
    .string()
    .optional()
    .describe("The reading account's label. Left out, every account is reported, sorted by label."),
})

export const engineSchema = z.object({
  status: z.enum(["missing", "mismatch", "ready"] satisfies EngineState["status"][]),
  python_version: z.string().nullable(),
  twscrape_version: z.string().nullable(),
  pinned_python: z.string(),
  pinned_twscrape: z.string(),
  recovery_command: z.string().nullable(),
})

export const accountSchema = z.object({
  label: z.string(),
  cookie_source: z.enum(["variable", "file"] satisfies CookieSource[]).nullable(),
  cookie_status: z.enum(["available", "missing", "invalid", "unreadable"] satisfies CookieStatus[]),
  refused_at: z.string().nullable(),
  refused_error: z.string().nullable(),
  rate_limited_until: z.string().nullable(),
  reads_last_hour: z.number(),
  reads_last_day: z.number(),
  reads_per_hour: z.number(),
  reads_per_day: z.number(),
  health: z.enum(["ready", "attention"]),
  reasons: z.array(z.string()),
  action: z.enum(ACTIONS).nullable(),
  hint: z.string().nullable(),
  recovery_command: z.string().nullable(),
})

export const accountReadOutput = z.object({ engine: engineSchema, accounts: z.array(accountSchema) })

export type AccountRow = z.infer<typeof accountSchema>
export type EngineRow = z.infer<typeof engineSchema>
