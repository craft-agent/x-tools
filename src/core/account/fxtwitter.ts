import { callsInLastDay, fxPaceSettings, fxPaths, readFxPacingState } from "../fxtwitter/pacing"
import { accountOnly } from "../sources/source"
import type { ToolOptions } from "../tool"
import type { FxtwitterRow } from "./schemas"

/**
 * What FxTwitter's state file and the settings say of FxTwitter at `now`: the
 * requests of the last 24 hours against the cap, and the cooldown while it
 * lies ahead. A missing file is no requests and no cooldown. It reads one file
 * and never contacts FxTwitter or creates anything.
 */
export async function readFxtwitterRow(
  stateDir: string,
  options: ToolOptions | undefined,
  now: number,
): Promise<FxtwitterRow> {
  const state = await readFxPacingState(fxPaths(stateDir))
  const cooldownEnd = state.cooldown_until === null ? NaN : Date.parse(state.cooldown_until)
  return {
    enabled: !accountOnly(options),
    reads_last_day: callsInLastDay(state.calls, now).length,
    reads_per_day: fxPaceSettings(options).perDay,
    cooldown_until: cooldownEnd > now ? new Date(cooldownEnd).toISOString() : null,
  }
}
