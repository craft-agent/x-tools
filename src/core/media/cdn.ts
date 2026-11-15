import { randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import { link, lstat, unlink } from "node:fs/promises"
import type { ClientRequest, IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import { join } from "node:path"
import { ToolError } from "../errors"
import { abortError } from "../exec"
import type { Connect } from "../fxtwitter/transport"

const PHOTO_HOST = "pbs.twimg.com"
const VIDEO_HOST = "video.twimg.com"

/** The only hosts a download may reach, redirects included: photos on one, videos and GIFs on the other. */
export const MEDIA_HOSTS: readonly string[] = [PHOTO_HOST, VIDEO_HOST]

/** The most bytes of one file a download keeps. */
export const MAX_MEDIA_BYTES = 500 * 1024 * 1024

/** The whole download, redirects and body included, in milliseconds. */
export const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000

/** The longest a download may go without a response or a byte, in milliseconds. */
export const STALL_TIMEOUT_MS = 30 * 1000

/** The most redirects followed for one download. */
export const MAX_MEDIA_REDIRECTS = 3

/** The mode a downloaded file is created with, before the process's umask. */
const FILE_MODE = 0o644

/** How many random bytes name a part file, so two downloads of one stem never share one. */
const PART_SUFFIX_BYTES = 8

const STEM_PATTERN = /^[0-9]+-[0-9]+$/

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/** What a download fetches: a photo, a video, or a GIF (which X serves as an MP4). */
export type MediaKind = "photo" | "video" | "gif"

/** The served media types a kind accepts, each with the extension its file gets. */
const EXTENSIONS: Readonly<Record<MediaKind, ReadonlyMap<string, string>>> = {
  photo: new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ]),
  video: new Map([["video/mp4", "mp4"]]),
  gif: new Map([["video/mp4", "mp4"]]),
}

/** Why a download failed, as `details.reason` of the error. */
export type MediaFailureReason =
  | "host"
  | "redirect"
  | "status"
  | "type"
  | "too_large"
  | "short"
  | "empty"
  | "network"
  | "timeout"
  | "stalled"
  | "exists"

const FAILURE_TEXT: Readonly<Record<MediaFailureReason, string>> = {
  host: "its address is not one of X's media hosts",
  redirect: "it redirected somewhere the download does not follow",
  status: "the server did not answer with the file",
  type: "the file is not of the type expected",
  too_large: "the file is too large",
  short: "the file arrived incomplete",
  empty: "the file is empty",
  network: "the connection failed",
  timeout: "the download timed out",
  stalled: "the download stopped sending data",
  exists: "something other than a media file is already at its destination",
}

/** How one download is made. */
export type DownloadOptions = {
  /** Sent as `User-Agent`, the only header of the request. */
  userAgent: string
  signal?: AbortSignal
  /** Defaults to `https.request`. */
  connect?: Connect
  /** For tests only: the time limit of the whole download; defaults to `DOWNLOAD_TIMEOUT_MS`. */
  timeoutMs?: number
  /** For tests only: the longest silence; defaults to `STALL_TIMEOUT_MS`. */
  stallMs?: number
  /** For tests only: the size cap; defaults to `MAX_MEDIA_BYTES`. */
  maxBytes?: number
  /** For tests only: the hosts allowed instead of `MEDIA_HOSTS`. */
  hosts?: readonly string[]
}

/** The file a download produced: `reused` when one was already there (then `mime` is null). */
export type Downloaded = { path: string; bytes: number; mime: string | null; reused: boolean }

/** `DownloadOptions` with every default filled in. */
type Settings = Required<Omit<DownloadOptions, "signal">> & { signal?: AbortSignal }

/** What a finished body leaves in the part file. */
type Received = { bytes: number; mime: string }

/** The error every refused or failed download throws: `upstream_error` naming the CDN as the source. */
function mediaError(reason: MediaFailureReason, cause?: unknown, status?: number): ToolError {
  return new ToolError("upstream_error", `The media could not be downloaded: ${FAILURE_TEXT[reason]}.`, {
    cause,
    details: { source: "cdn", reason, ...(status ? { status } : {}) },
  })
}

/** The error for a file the machine could not write; it blames no upstream. */
function writeError(cause: unknown): ToolError {
  return new ToolError("internal_error", "The media could not be saved to the download directory.", { cause })
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined
}

/** Whether a request may be sent to `url`: https, one of `hosts` on its default port, and no credentials. */
function mayFetch(url: URL, hosts: readonly string[]): boolean {
  return (
    url.protocol === "https:" &&
    hosts.includes(url.hostname) &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  )
}

/** The media type of a `Content-Type` header: the part before any `;`, trimmed and lowercased. */
function mediaType(header: string | undefined): string | undefined {
  const type = header?.split(";")[0]?.trim().toLowerCase()
  return type ? type : undefined
}

/** The size of the regular, non-empty file at `path`; undefined for anything else, a symlink included. */
async function usableSize(path: string): Promise<number | undefined> {
  try {
    const stats = await lstat(path)
    return stats.isFile() && stats.size > 0 ? stats.size : undefined
  } catch {
    return undefined
  }
}

/** The file of `stem` already in `dir`, under any extension `kind` allows. */
async function findExisting(dir: string, kind: MediaKind, stem: string): Promise<Downloaded | undefined> {
  for (const extension of EXTENSIONS[kind].values()) {
    const path = join(dir, `${stem}.${extension}`)
    const bytes = await usableSize(path)
    if (bytes !== undefined) return { path, bytes, mime: null, reused: true }
  }
  return undefined
}

/**
 * The URL of a photo at its original size: `name=orig` set on a `pbs.twimg.com`
 * URL, its other parameters kept and its fragment dropped. Any other URL is
 * returned as it is; the download refuses it.
 */
export function originalPhotoUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.hostname !== PHOTO_HOST) return url
  parsed.searchParams.set("name", "orig")
  parsed.hash = ""
  return parsed.toString()
}

/**
 * Streams the body of a `GET` of `start` into a new file at `part`, following
 * redirects and checking every limit as it goes. When it rejects, the request
 * is destroyed and the file closed, so the caller may remove `part`.
 */
function receive(start: URL, kind: MediaKind, part: string, settings: Settings): Promise<Received> {
  const { userAgent, signal, connect, timeoutMs, stallMs, maxBytes, hosts } = settings

  return new Promise<Received>((resolve, reject) => {
    let current: ClientRequest | undefined
    let file: ReturnType<typeof createWriteStream> | undefined
    let fileClosed = true
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(stallTimer)
      signal?.removeEventListener("abort", onAbort)
      current?.destroy()
      if (file && !fileClosed) {
        file.once("close", settle)
        file.destroy()
      } else {
        settle()
      }
    }
    const abort = (error: unknown): void => finish(() => reject(error))
    const fail = (reason: MediaFailureReason, cause?: unknown, status?: number): void =>
      abort(mediaError(reason, cause, status))
    const onAbort = (): void => abort(abortError(signal!))
    const armStall = (): void => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => fail("stalled"), stallMs)
    }
    const timer = setTimeout(() => fail("timeout"), timeoutMs)
    signal?.addEventListener("abort", onAbort, { once: true })

    const readBody = (response: IncomingMessage): void => {
      if (response.statusCode !== 200) return fail("status", undefined, response.statusCode)
      const mime = mediaType(response.headers["content-type"])
      if (mime === undefined || !EXTENSIONS[kind].has(mime)) return fail("type")
      const header = response.headers["content-length"]
      const length = header === undefined ? Number.NaN : Number(header)
      const declared = Number.isSafeInteger(length) && length >= 0 ? length : undefined
      if (declared !== undefined && declared > maxBytes) return fail("too_large")

      const output = createWriteStream(part, { flags: "wx", mode: FILE_MODE })
      file = output
      fileClosed = false
      output.on("close", () => (fileClosed = true))
      output.on("error", (error) => abort(writeError(error)))

      let size = 0
      const cut = (cause?: unknown): void => fail(declared === undefined ? "network" : "short", cause)
      response.on("data", (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > maxBytes) return fail("too_large")
        armStall()
        if (output.write(chunk)) return
        response.pause()
        clearTimeout(stallTimer)
        output.once("drain", () => {
          if (settled) return
          response.resume()
          armStall()
        })
      })
      response.on("error", cut)
      response.on("close", () => {
        if (!response.complete) cut()
      })
      response.on("end", () => {
        if (settled) return
        clearTimeout(stallTimer)
        if (size === 0) return fail("empty")
        if (declared !== undefined && size !== declared) return fail("short")
        output.once("close", () => finish(() => resolve({ bytes: size, mime })))
        output.end()
      })
    }

    const drain = (response: IncomingMessage): void => {
      // A reply that is dropped may be cut off when its request is destroyed; that is not a failure.
      response.on("error", () => {})
      response.resume()
    }

    const follow = (response: IncomingMessage, from: URL, redirects: number): void => {
      drain(response)
      const location = response.headers.location
      if (location === undefined || redirects >= MAX_MEDIA_REDIRECTS) return fail("redirect")
      let target: URL
      try {
        target = new URL(location, from)
      } catch (error) {
        return fail("redirect", error)
      }
      if (!mayFetch(target, hosts)) return fail("redirect")
      send(target, redirects + 1)
    }

    const send = (url: URL, redirects: number): void => {
      current?.destroy()
      const request = connect(
        {
          protocol: "https:",
          hostname: url.hostname,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          agent: false,
          headers: { "User-Agent": userAgent },
        },
        (response) => {
          if (settled || request !== current) return drain(response)
          if (REDIRECT_STATUSES.has(response.statusCode ?? 0)) return follow(response, url, redirects)
          readBody(response)
        },
      )
      current = request
      request.on("error", (error) => {
        if (request === current) fail("network", error)
      })
      armStall()
      request.end()
    }

    send(start, 0)
  })
}

/**
 * Puts the finished part file at `path` without ever overwriting: a hard link,
 * which fails when the name is taken. A name taken by a regular, non-empty file
 * is that file reused; anything else there is the `exists` failure.
 */
async function place(part: string, path: string, received: Received): Promise<Downloaded> {
  try {
    await link(part, path)
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw writeError(error)
    const bytes = await usableSize(path)
    if (bytes === undefined) throw mediaError("exists", error)
    return { path, bytes, mime: null, reused: true }
  }
  return { path, bytes: received.bytes, mime: received.mime, reused: false }
}

/**
 * Downloads one media file from X's CDN into `dir` as `<stem>.<extension>`,
 * the extension coming from the served type, never from the URL.
 *
 * `dir` must exist and have been checked by the caller, and `stem` must be
 * `<digits>-<digits>` (`internal_error` otherwise). A regular, non-empty file
 * of that stem in `dir` under any extension `kind` allows is returned as
 * `reused`, with no request. Otherwise `url` is fetched, only from `MEDIA_HOSTS`,
 * with a `User-Agent` and nothing else, under the limits of `DownloadOptions`.
 *
 * The body goes to a hidden part file that is linked to its final name only when
 * complete and checked, and removed on any failure, refusal or abort. Every
 * failure is `upstream_error` with `details.source: "cdn"` and a
 * `details.reason`; a file the machine cannot write is `internal_error`; an
 * abort rejects with an `AbortError`.
 */
export async function downloadMedia(
  url: string,
  kind: MediaKind,
  dir: string,
  stem: string,
  options: DownloadOptions,
): Promise<Downloaded> {
  if (!STEM_PATTERN.test(stem)) {
    throw new ToolError("internal_error", `A media file stem must be <digits>-<digits>; got ${JSON.stringify(stem)}.`)
  }
  const settings: Settings = {
    userAgent: options.userAgent,
    signal: options.signal,
    connect: options.connect ?? httpsRequest,
    timeoutMs: options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS,
    stallMs: options.stallMs ?? STALL_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? MAX_MEDIA_BYTES,
    hosts: options.hosts ?? MEDIA_HOSTS,
  }
  const { signal, hosts } = settings

  let start: URL | undefined
  try {
    start = new URL(url)
  } catch (error) {
    throw mediaError("host", error)
  }
  if (!mayFetch(start, hosts)) throw mediaError("host")
  if (signal?.aborted) throw abortError(signal)

  const existing = await findExisting(dir, kind, stem)
  if (existing) return existing

  const part = join(dir, `.${stem}.${randomBytes(PART_SUFFIX_BYTES).toString("hex")}.part`)
  try {
    const received = await receive(start, kind, part, settings)
    if (signal?.aborted) throw abortError(signal)
    const extension = EXTENSIONS[kind].get(received.mime)!
    return await place(part, join(dir, `${stem}.${extension}`), received)
  } finally {
    await unlink(part).catch(() => {})
  }
}
