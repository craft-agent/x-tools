import { setTimeout as delay } from "node:timers/promises"

/** Waits `ms` on a timer, rejecting with an `AbortError` when `signal` aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal })
}
