import type { ToolSpec } from "./core"
import { xAccountRead } from "./core/account/read"
import { xPostRead } from "./core/posts/read"
import { xUserRead } from "./core/users/read"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [xAccountRead, xPostRead, xUserRead]
