import { createServer, request as httpRequest, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "../errors"
import type { Connect } from "../fxtwitter/transport"
import { rejected } from "../fxtwitter/fxtwitter.testing"
import { downloadMedia, type DownloadOptions, type Downloaded, type MediaKind } from "./cdn"

/** Fixtures the media download tests share: a fake CDN on 127.0.0.1, the `connect` that reaches it, and a temp directory. */

export { rejected, waitUntil } from "../fxtwitter/fxtwitter.testing"

/** A generic `User-Agent` for media tests. */
export const TEST_USER_AGENT = "test-client/1"

/** A stem the way the media tool names files: post id, then the media's position. */
export const STEM = "123-1"

/** A photo and a video URL on the real hosts; the fake `connect` sends them to the local server. */
export const PHOTO_URL = "https://pbs.twimg.com/media/AbC.jpg?name=orig"
export const VIDEO_URL = "https://video.twimg.com/ext_tw_video/1/vid/clip.mp4"

/** What the fake answers a path with. */
export type Handler = (response: ServerResponse) => void

/** A request the fake saw. */
export type RecordedRequest = { method: string; path: string; headers: IncomingHttpHeaders }

const LOOPBACK = "127.0.0.1"

/** A fixed-length reply: the status, the headers (a `Content-Length` of the body's size unless given) and the body. */
export function reply(status: number, headers: Record<string, string>, body: string | Buffer = ""): Handler {
  return (response) => {
    response.writeHead(status, { "Content-Length": String(Buffer.byteLength(body)), ...headers })
    response.end(body)
  }
}

/** An answer with a body of the given type. */
export const file = (type: string | undefined, body: string | Buffer): Handler =>
  reply(200, type === undefined ? {} : { "Content-Type": type }, body)

/** A redirect to `location`. */
export const redirect = (location: string, status = 302): Handler => reply(status, { Location: location })

/** Announces `declared` bytes, sends `body`, then cuts the connection. */
export const cutShort =
  (type: string, declared: number, body: string): Handler =>
  (response) => {
    response.writeHead(200, { "Content-Type": type, "Content-Length": String(declared) })
    response.write(body, () => response.destroy())
  }

/** Sends `chunks` with no length announced, `delayMs` apart. */
export const chunked =
  (type: string, chunks: readonly (string | Buffer)[], delayMs: number): Handler =>
  (response) => {
    response.writeHead(200, { "Content-Type": type })
    let index = 0
    const next = (): void => {
      if (response.destroyed) return
      if (index >= chunks.length) return void response.end()
      response.write(chunks[index++])
      setTimeout(next, delayMs)
    }
    next()
  }

/** Answers after `delayMs`. */
export const late =
  (delayMs: number, handler: Handler): Handler =>
  (response) => {
    const timer = setTimeout(() => handler(response), delayMs)
    response.on("close", () => clearTimeout(timer))
  }

/** A running fake CDN with a fresh download directory. */
export type MediaFixture = {
  dir: string
  /** The `https.request` stand-in that sends a request to the fake. */
  connect: Connect
  /** Every request, in order. */
  requests: RecordedRequest[]
  /** Replies cut off by the client before they were finished. */
  cutOff: () => number
  /** Answers `path` (with its query) with `handler` from now on. */
  route(path: string, handler: Handler): void
  /** Downloads `url` into `dir` through the fake. */
  download(url: string, kind?: MediaKind, extra?: Partial<DownloadOptions>): Promise<Downloaded>
  /** The `details` a download fails with; throws when the failure is not an `upstream_error`. */
  detailsOf(promise: Promise<unknown>): Promise<unknown>
  /** The names in `dir`, part files included. */
  listing(): Promise<string[]>
  /** Stops the server, cuts every connection and removes `dir`. */
  stop(): Promise<void>
}

/** Starts a fake CDN and a temp directory; a request to no route is a 404. */
export async function startMediaFixture(): Promise<MediaFixture> {
  const dir = await mkdtemp(join(tmpdir(), "x-tools-media-"))
  const routes = new Map<string, Handler>()
  const requests: RecordedRequest[] = []
  let cutOff = 0

  const server = createServer((request, response) => {
    const path = request.url ?? ""
    requests.push({ method: request.method ?? "GET", path, headers: request.headers })
    response.on("close", () => {
      if (!response.writableFinished) cutOff += 1
    })
    ;(routes.get(path) ?? reply(404, {}))(response)
  })
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve))
  const { port } = server.address() as AddressInfo

  const connect: Connect = (options, callback) =>
    httpRequest(
      { host: LOOPBACK, port, method: options.method, path: options.path, headers: options.headers, agent: false },
      callback,
    )

  const download: MediaFixture["download"] = (url, kind = "photo", extra = {}) =>
    downloadMedia(url, kind, dir, STEM, { userAgent: TEST_USER_AGENT, connect, ...extra })

  let stopped: Promise<void> | undefined
  return {
    dir,
    connect,
    requests,
    cutOff: () => cutOff,
    route: (path, handler) => void routes.set(path, handler),
    download,
    detailsOf: async (promise) => {
      const error = await rejected(promise)
      if (!isToolError(error) || error.code !== "upstream_error") throw new Error(`not a CDN failure: ${error}`)
      return error.details
    },
    listing: () => readdir(dir),
    stop: () => {
      stopped ??= new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }).then(() => rm(dir, { recursive: true, force: true }))
      return stopped
    },
  }
}
