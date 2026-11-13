import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PYTHON_VERSION, TWSCRAPE_VERSION, enginePaths } from "./engine"

/** Fixtures the engine tests share: a fake uv on a private PATH and venvs laid out by hand. */

/** What the fake uv reads from files beside it, so a test steers it without passing it variables. */
type FakeUvSetting = "python-version" | "twscrape-version" | "fail-venv" | "fail-sync"

const FAKE_UV_SCRIPT = `#!/bin/sh
dir=$(dirname "$0")
printf '%s\\n' "$*" >> "$dir/uv.log"
printf 'UV_NO_CONFIG=%s UV_CACHE_DIR=%s STRAY=%s\\n' "$UV_NO_CONFIG" "$UV_CACHE_DIR" "$STRAY" >> "$dir/uv.env"
case "$1" in
  --version)
    echo "uv 0.0.0"
    ;;
  venv)
    if [ -f "$dir/fail-venv" ]; then cat "$dir/fail-venv" >&2; exit 2; fi
    venv="$2"
    rm -rf "$venv"
    mkdir -p "$venv/bin"
    printf '#!/bin/sh\\n' > "$venv/bin/python"
    chmod 755 "$venv/bin/python"
    version=$(cat "$dir/python-version" 2>/dev/null || echo ${PYTHON_VERSION})
    printf 'home = /somewhere\\nversion_info = %s\\n' "$version" > "$venv/pyvenv.cfg"
    ;;
  pip)
    if [ -f "$dir/fail-sync" ]; then cat "$dir/fail-sync" >&2; exit 3; fi
    venv=$(dirname "$(dirname "$4")")
    version=$(cat "$dir/twscrape-version" 2>/dev/null || echo ${TWSCRAPE_VERSION})
    rm -rf "$venv"/lib/python3.12/site-packages/twscrape-*.dist-info
    mkdir -p "$venv/lib/python3.12/site-packages/twscrape-$version.dist-info"
    ;;
esac
`

/** A fake uv and the environment that finds it. */
export type FakeUv = {
  /** The directory holding the fake `uv`. */
  bin: string
  /** An environment whose `PATH` is the fake's directory and the system's basics. */
  env: Record<string, string>
  /** Makes the fake behave differently from now on. */
  set(setting: FakeUvSetting, value: string): Promise<void>
  /** The arguments of each call so far, one string per call. */
  calls(): Promise<string[]>
  /** The environment lines (`UV_NO_CONFIG`, `UV_CACHE_DIR`, `STRAY`) of each call so far. */
  environments(): Promise<string[]>
}

const directories: string[] = []

/** Removes the directories `tempDir` made; a test file runs it after each test. */
export async function removeTempDirs(): Promise<void> {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

/** A fresh temporary directory (its real path), removed after the test. */
export async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "engine-")))
  directories.push(dir)
  return dir
}

async function readLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split("\n").filter((line) => line !== "")
  } catch {
    return []
  }
}

/** Puts a fake `uv` in a fresh directory that only the returned environment's `PATH` finds. */
export async function fakeUv(): Promise<FakeUv> {
  const bin = join(await tempDir(), "bin")
  await mkdir(bin)
  await writeFile(join(bin, "uv"), FAKE_UV_SCRIPT)
  await chmod(join(bin, "uv"), 0o755)
  return {
    bin,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: bin, STRAY: "leaks", UV_CACHE_DIR: "/cache/uv" },
    set: (setting, value) => writeFile(join(bin, setting), value),
    calls: () => readLines(join(bin, "uv.log")),
    environments: () => readLines(join(bin, "uv.env")),
  }
}

/** An environment without the fake's directory on `PATH`, so uv is not found. */
export const NO_UV_ENV = { PATH: "/usr/bin:/bin" }

/** What a hand-made venv holds; a field left out is not created, and `python: false` leaves the interpreter out. */
export type VenvLayout = { python?: boolean; pythonVersion?: string; twscrape?: string }

/** Lays out the venv under `stateDir` as uv leaves it. */
export async function writeVenv(stateDir: string, layout: VenvLayout = {}): Promise<void> {
  const { venv, python } = enginePaths(stateDir)
  await mkdir(join(venv, "bin"), { recursive: true })
  if (layout.python !== false) {
    await writeFile(python, "#!/bin/sh\n")
    await chmod(python, 0o755)
  }
  if (layout.pythonVersion !== undefined) {
    await writeFile(join(venv, "pyvenv.cfg"), `home = /somewhere\nversion_info = ${layout.pythonVersion}\n`)
  }
  if (layout.twscrape !== undefined) {
    await mkdir(join(venv, "lib", "python3.12", "site-packages", `twscrape-${layout.twscrape}.dist-info`), {
      recursive: true,
    })
  }
}

/** A requirements file in a fresh directory, and its path. */
export async function lockFile(): Promise<string> {
  const path = join(await tempDir(), "requirements.lock")
  await writeFile(path, `twscrape==${TWSCRAPE_VERSION}\n`)
  return path
}
