import type { ClientRequest, IncomingMessage } from "node:http"
import { request as httpsRequest, type RequestOptions } from "node:https"
import { ToolError } from "../errors"
import { abortError } from "../exec"

/** The only host the client talks to, redirects included. */
export const FX_HOST = "api.fxtwitter.com"

/** The whole request, redirects and body included, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 15_000

/** The most bytes of a reply the client reads. */
export const MAX_REPLY_BYTES = 2 * 1024 * 1024

/** The most redirects followed for one request. */
export const MAX_REDIRECTS = 3

/** Every path starts with the API version the client speaks. */
const PATH_PREFIX = "/2/"

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/** Why FxTwitter could not be read, as `details.reason` of the error. */
export type FxFailureReason = "network" | "timeout" | "too_large" | "redirect" | "not_json"

const FAILURE_TEXT: Readonly<Record<FxFailureReason, string>> = {
  network: "the connection failed",
  timeout: "the request timed out",
  too_large: "its reply was too large",
  redirect: "it redirected somewhere the client does not follow",
  not_json: "its reply was not JSON",
}

/** What FxTwitter answered: the status, the raw `Retry-After` header and the parsed JSON body (null when empty). */
export type FxResponse = { status: number; retryAfter: string | null; body: unknown }

/** The shape of `https.request(options, callback)`, so a test can send the request elsewhere. */
export type Connect = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest

/** How one request is made. */
export type FxGetOptions = {
  /** Sent as `User-Agent`; FxTwitter refuses a request without one. */
  userAgent: string
  signal?: AbortSignal
  /** Defaults to `https.request`. */
  connect?: Connect
  /** For tests only: the time limit of the whole request; defaults to `REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number
}

/** Throws `internal_error` unless `path` is a path of FxTwitter's v2 API. */
export function checkFxPath(path: string): void {
  if (!path.startsWith(PATH_PREFIX)) {
    throw new ToolError(
      "internal_error",
      `An FxTwitter path must start with "${PATH_PREFIX}"; got ${JSON.stringify(path)}.`,
    )
  }
}

/** The error every failed request throws: `upstream_error` naming FxTwitter as the source. */
function fxError(reason: FxFailureReason, cause?: unknown): ToolError {
  return new ToolError("upstream_error", `FxTwitter could not be read: ${FAILURE_TEXT[reason]}.`, {
    cause,
    details: { source: "fxtwitter", reason },
  })
}

/** Whether a redirect may be followed: https, `FX_HOST` on its default port, and a path of the v2 API. */
function mayFollow(url: URL): boolean {
  return (
    url.protocol === "https:" && url.hostname === FX_HOST && url.port === "" && url.pathname.startsWith(PATH_PREFIX)
  )
}

/** The parsed JSON of `text`; null when it is blank; throws `not_json` otherwise. */
function parseBody(text: string): unknown {
  if (text.trim() === "") return null
  try {
    return JSON.parse(text)
  } catch (error) {
    throw fxError("not_json", error)
  }
}

/**
 * One HTTPS `GET` of `path` (a path of the v2 API) on `api.fxtwitter.com`,
 * with a `User-Agent` and `Accept: application/json` and nothing else: no
 * cookie and no credential. The reply is returned as it is, whatever its
 * status; a 404 or a 401 is the caller's to read.
 *
 * Redirects are followed only to `https://api.fxtwitter.com/2/…`, at most
 * `MAX_REDIRECTS` times (`redirect` otherwise). The whole request is limited
 * to `REQUEST_TIMEOUT_MS` (`timeout`), the reply to `MAX_REPLY_BYTES`
 * (`too_large`, read as far as the cap and no further), and an empty body is
 * `null`. Every failure is `upstream_error` with `details.source: "fxtwitter"`
 * and a `details.reason`; an abort rejects with an `AbortError`, and the
 * request is destroyed either way.
 */
export async function fxGet(path: string, options: FxGetOptions): Promise<FxResponse> {
  checkFxPath(path)
  const { userAgent, signal, connect = httpsRequest, timeoutMs = REQUEST_TIMEOUT_MS } = options
  if (signal?.aborted) throw abortError(signal)

  return new Promise<FxResponse>((resolve, reject) => {
    let current: ClientRequest | undefined
    let settled = false

    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      current?.destroy()
      settle()
    }
    const fail = (reason: FxFailureReason, cause?: unknown): void => finish(() => reject(fxError(reason, cause)))
    const onAbort = (): void => finish(() => reject(abortError(signal!)))
    const timer = setTimeout(() => fail("timeout"), timeoutMs)
    signal?.addEventListener("abort", onAbort, { once: true })

    const readBody = (response: IncomingMessage): void => {
      const declared = Number(response.headers["content-length"])
      if (declared > MAX_REPLY_BYTES) return fail("too_large")
      const chunks: Buffer[] = []
      let size = 0
      response.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_REPLY_BYTES) return fail("too_large")
        chunks.push(chunk)
      })
      response.on("error", (error) => fail("network", error))
      response.on("close", () => {
        if (!response.complete) fail("network")
      })
      response.on("end", () => {
        finish(() => {
          try {
            const body = parseBody(Buffer.concat(chunks).toString("utf8"))
            resolve({ status: response.statusCode ?? 0, retryAfter: response.headers["retry-after"] ?? null, body })
          } catch (error) {
            reject(error)
          }
        })
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
      if (location === undefined || redirects >= MAX_REDIRECTS) return fail("redirect")
      let target: URL
      try {
        target = new URL(location, from)
      } catch (error) {
        return fail("redirect", error)
      }
      if (!mayFollow(target)) return fail("redirect")
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
          headers: { "User-Agent": userAgent, Accept: "application/json" },
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
      request.end()
    }

    send(new URL(`https://${FX_HOST}${path}`), 0)
  })
}
