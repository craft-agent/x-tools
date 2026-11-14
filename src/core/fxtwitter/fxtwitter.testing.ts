import { createServer, request as httpRequest, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import type { Connect } from "./transport"

/** Fixtures the FxTwitter tests share: a fake FxTwitter on 127.0.0.1 and the `connect` that reaches it. */

/** A generic `User-Agent` for FxTwitter tests. */
export const TEST_USER_AGENT = "test-client/1"

/** Where injected clocks start in FxTwitter tests. */
export const T0 = Date.parse("2026-01-01T00:00:00.000Z")

/** Formats epoch milliseconds as ISO 8601. */
export const iso = (ms: number): string => new Date(ms).toISOString()

/** Reply bytes written one chunk after another, with no length announced. */
export type FakeChunks = { chunks: readonly (string | Buffer)[]; chunkDelayMs?: number }

/** How a body goes out: text or bytes at once, an object as JSON, or chunks. */
export type FakeBody = string | Buffer | FakeChunks | object

/** What the fake answers a route with. */
export type FakeReply = {
  status: number
  headers?: Record<string, string>
  body?: FakeBody
  /** Waits this long before answering. */
  delayMs?: number
}

/** A request the fake saw. */
export type RecordedRequest = { method: string; path: string; headers: IncomingHttpHeaders }

/** What the fake counted about its connections. */
export type FakeStats = {
  /** Replies the client closed before they were finished. */
  cutOff: number
  /** The most requests held open at once. */
  maxInFlight: number
}

/** A running fake FxTwitter. */
export type FakeFxTwitter = {
  /** Every request, in order. */
  requests: RecordedRequest[]
  /** The host each request was addressed to before `connect` sent it here. */
  hosts: string[]
  stats: FakeStats
  /** Answers `path` (with its query) with `reply` from now on. */
  route(path: string, reply: FakeReply, method?: string): void
  /** The `https.request` stand-in that sends a request to the fake. */
  connect: Connect
  /** Stops the server and cuts every connection; calling it again does nothing. */
  stop(): Promise<void>
}

const LOOPBACK = "127.0.0.1"

/** How long a chunked reply waits between chunks, unless the reply says. */
const DEFAULT_CHUNK_DELAY_MS = 5

const WAIT_POLL_MS = 5
const MAX_WAIT_ATTEMPTS = 200

const NOT_ROUTED: FakeReply = { status: 404, body: { error: "not routed" } }

function isChunks(body: FakeBody): body is FakeChunks {
  return typeof body === "object" && "chunks" in body && Array.isArray(body.chunks)
}

/** Writes the reply's body; stops when the client is gone. */
async function writeBody(response: ServerResponse, body: FakeBody | undefined): Promise<void> {
  if (body === undefined) response.end()
  else if (typeof body === "string" || Buffer.isBuffer(body)) response.end(body)
  else if (!isChunks(body)) response.end(JSON.stringify(body))
  else {
    for (const chunk of body.chunks) {
      if (response.destroyed) return
      response.write(chunk)
      await delay(body.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS)
    }
    if (!response.destroyed) response.end()
  }
}

/** The error `promise` rejects with; fails the test by returning undefined when it resolves. */
export function rejected(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** Waits until `condition` holds, polling every 5 ms for up to a second; the test's own assertion then reports a miss. */
export async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS && !condition(); attempt++) await delay(WAIT_POLL_MS)
}

/** Starts a fake FxTwitter whose routes the test sets; a request to no route is a 404 with a JSON body. */
export async function startFakeFxTwitter(): Promise<FakeFxTwitter> {
  const routes = new Map<string, FakeReply>()
  const requests: RecordedRequest[] = []
  const hosts: string[] = []
  const stats: FakeStats = { cutOff: 0, maxInFlight: 0 }
  let inFlight = 0

  const server = createServer((request, response) => {
    const method = request.method ?? "GET"
    const path = request.url ?? ""
    requests.push({ method, path, headers: request.headers })
    const reply = routes.get(`${method} ${path}`) ?? NOT_ROUTED
    inFlight += 1
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight)

    const controller = new AbortController()
    response.on("close", () => {
      inFlight -= 1
      if (!response.writableFinished) stats.cutOff += 1
      controller.abort()
    })
    delay(reply.delayMs ?? 0, undefined, { signal: controller.signal })
      .then(() => {
        response.writeHead(reply.status, reply.headers)
        return writeBody(response, reply.body)
      })
      .catch(() => response.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve))
  const { port } = server.address() as AddressInfo

  const connect: Connect = (options, callback) => {
    hosts.push(String(options.hostname))
    const target = {
      host: LOOPBACK,
      port,
      method: options.method,
      path: options.path,
      headers: options.headers,
      agent: false,
    }
    return httpRequest(target, callback)
  }

  let stopped: Promise<void> | undefined
  return {
    requests,
    hosts,
    stats,
    route: (path, reply, method = "GET") => void routes.set(`${method} ${path}`, reply),
    connect,
    stop: () => {
      stopped ??= new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      return stopped
    },
  }
}
