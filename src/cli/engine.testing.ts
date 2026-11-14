import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { TWSCRAPE_VERSION } from "../core/x/engine"
import { tempDir } from "../core/x/engine.testing"

/** Fixtures the `engine` command tests share. */

/** A package directory that holds the engine's requirements file, as the installed package does. */
export async function ownDirWithLock(): Promise<string> {
  const dir = await tempDir()
  await mkdir(join(dir, "engine"))
  await writeFile(join(dir, "engine", "requirements.lock"), `twscrape==${TWSCRAPE_VERSION}\n`)
  return dir
}
