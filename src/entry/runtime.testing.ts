import { expect, mock } from "bun:test"
import { z } from "zod"
import { defineTool, type ToolContext } from "../core"
import { PROJECT } from "../project"
import type { RuntimeOptions } from "./runtime"
import { profile } from "./settings.testing"

/** The runtime dependencies every entry point is given in its tests: a profile, an environment and a clock that records its calls. */
export function runtimeFixture(): Required<RuntimeOptions> {
  return { profile, env: { MARKER: "injected" }, now: mock(() => 123456) }
}

/** An add tool of `alpha` that records the context its `targets` and its `execute` get, and answers with the runtime's clock. */
export function runtimeProbe() {
  const options = runtimeFixture()
  const targets: ToolContext[] = []
  const executions: ToolContext[] = []
  const spec = defineTool({
    id: "demo_runtime_probe",
    title: "Runtime probe",
    description: "Records the context supplied to targets and execution.",
    toolset: "alpha",
    class: "add",
    input: z.object({}),
    output: z.object({ time: z.number() }),
    targets(_args, ctx) {
      targets.push(ctx)
      return ["runtime-target"]
    },
    async execute(_args, ctx) {
      executions.push(ctx)
      return { time: ctx.runtime!.now() }
    },
  })
  /** Expects the context to carry the injected runtime; `now` is the clock it must hold, the injected one unless the entry point has no way to inject one. */
  function check(ctx: ToolContext, now: () => number = options.now) {
    expect(ctx.runtime?.envPrefix).toBe(options.profile.envPrefix)
    expect(ctx.runtime?.cli).toBe(PROJECT.cli)
    expect(ctx.runtime?.env).toBe(options.env)
    expect(ctx.runtime?.now).toBe(now)
  }
  return { options, spec, targets, executions, check }
}
