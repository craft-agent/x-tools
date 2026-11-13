import type { ToolSpec } from "./core"
import { xAccountRead } from "./core/account/read"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [xAccountRead]
