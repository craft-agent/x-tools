import type { ToolSpec } from "./core"
import { xAccountRead } from "./core/account/read"
import { xCommunityRead } from "./core/communities/read"
import { xListRead } from "./core/lists/read"
import { xPostRead } from "./core/posts/read"
import { xTrendRead } from "./core/trends/read"
import { xUserRead } from "./core/users/read"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [xAccountRead, xPostRead, xUserRead, xListRead, xCommunityRead, xTrendRead]
