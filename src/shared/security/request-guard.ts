// Request-boundary body limit and request id.
//
// Two controls wired as one nitro v3 plugin (server/plugins/request-guard.ts):
//
//   1. Body-size limit — requests whose declared content-length exceeds
//      REQUEST_BODY_LIMIT_BYTES are rejected 413 BEFORE routing or body reads.
//      A path may carry a larger limit of its own (an image upload), matched on
//      the exact pathname only, so widening one endpoint never widens another.
//      Mechanism: the nitro `request` runtime hook CANNOT short-circuit (nitro
//      routes hook errors into captureError and lets the request through —
//      verified against nitro's runtime app.mjs), so the guard wraps the h3
//      app's config.onRequest directly. H3 normalizes thrown non-Errors to 500,
//      so a typed HTTP error carries the refusal to a matching onError wrapper.
//      Returning its Response there preserves the content-free body and response
//      hooks, including security headers and the request id.
//      A declared length is exact (the HTTP parser frames the body by it), so
//      such a body is never read here: its handler decides what to read, and
//      when. A body with NO declared length (chunked) is counted as it arrives
//      on a clone and refused at the same limit; the request itself keeps every
//      byte and its runtime metadata for the handler.
//
//   2. x-request-id — honored when the inbound id is sane (bounded length,
//      header-safe charset), generated otherwise; set on EVERY response via
//      the nitro `response` hook. `requestId` is an approved correlation
//      field (BQC-7.3 metrics schema).
//
// The pure decisions live here (unit-tested); the plugin file is thin wiring.

import type { NitroAppPlugin } from 'nitro/types'
import { HTTPError } from 'nitro/h3'
import { getLogger } from '#/shared/observability/logger'

/** Maximum accepted length for an inbound x-request-id (bytes as chars). */
export const MAX_INBOUND_REQUEST_ID_LENGTH = 128

/** Header-safe token charset: alphanumerics plus `.` `_` `~` `-`. */
const REQUEST_ID_CHARSET = /^[A-Za-z0-9._~-]+$/

/**
 * Resolve the request id for a response: the inbound id when sane, otherwise
 * a freshly generated one. Untrusted inbound values are never echoed — a
 * reflected header must not become an injection/carriage-return vector.
 */
export function resolveRequestId(
  inbound: string | null | undefined,
  idGen: () => string,
): string {
  if (
    inbound &&
    inbound.length <= MAX_INBOUND_REQUEST_ID_LENGTH &&
    REQUEST_ID_CHARSET.test(inbound)
  ) {
    return inbound
  }
  return idGen()
}

/** The content-free 413 every body-limit refusal answers with. */
function payloadTooLarge(): Response {
  return new Response(JSON.stringify({ error: 'payload_too_large' }), {
    status: 413,
    headers: { 'content-type': 'application/json' },
  })
}

class PayloadTooLargeError extends HTTPError {
  constructor(readonly response: Response) {
    super({ status: 413 })
  }
}

/**
 * Return a content-free 413 Response when the declared content-length exceeds
 * the limit, undefined otherwise (absent/unparseable length = allowed — the
 * HTTP parser rejects protocol violations before this guard runs).
 */
export function bodyLimitRejection(
  contentLength: string | null | undefined,
  limitBytes: number,
): Response | undefined {
  if (contentLength == null) return undefined
  const declared = Number(contentLength)
  if (!Number.isFinite(declared) || declared <= limitBytes) return undefined
  return payloadTooLarge()
}

export type PathBodyLimit = Readonly<{
  /** The exact pathname the limit applies to: no prefix, no case folding. */
  path: string
  limitBytes: number
}>

/**
 * The body limit for a pathname: the default, or a path's own larger limit.
 * An override can only widen — the default is the floor.
 */
export function bodyLimitFor(
  pathname: string,
  defaultLimitBytes: number,
  pathLimits: readonly PathBodyLimit[] = [],
): number {
  const own = pathLimits.find((candidate) => candidate.path === pathname)
  return own ? Math.max(own.limitBytes, defaultLimitBytes) : defaultLimitBytes
}

/**
 * Whether a body runs past the limit, counting its bytes as they arrive. The
 * count runs on a clone, so the request keeps every byte (and its server
 * runtime extensions) for its handler. A stream that fails, such as a client
 * that disconnected, is not an oversized body: the handler meets the same
 * failure when it reads.
 */
async function bodyExceedsLimit(request: Request, limitBytes: number): Promise<boolean> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = request.clone().body?.getReader()
    if (!reader) return false
    let bytes = 0
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return false
      bytes += chunk.value.byteLength
      if (bytes > limitBytes) {
        // Cancelling one branch of a clone settles only once both have stopped,
        // so neither is awaited: the refusal must not wait on an untrusted source.
        void reader.cancel().catch(() => {})
        void request.body?.cancel().catch(() => {})
        return true
      }
    }
  } catch {
    return false
  } finally {
    reader?.releaseLock()
  }
}

/** The pathname of a request, or '' when its URL cannot be read. */
function pathnameOf(request: Request): string {
  try {
    return new URL(request.url, 'http://localhost').pathname
  } catch {
    return ''
  }
}

export type RequestGuardOptions = Readonly<{
  /** Maximum accepted request body size in bytes (declared, or counted when undeclared). */
  bodyLimitBytes: number
  /** Larger limits for named endpoints; every other path keeps `bodyLimitBytes`. */
  pathBodyLimits?: readonly PathBodyLimit[]
  /** Id generator for requests without a sane inbound id (tests inject). */
  idGen?: () => string
}>

/** Build the nitro plugin wiring the body limit + request-id controls. */
export function createRequestGuardPlugin(opts: RequestGuardOptions): NitroAppPlugin {
  const idGen = opts.idGen ?? (() => crypto.randomUUID())

  return (nitroApp) => {
    const h3 = nitroApp.h3
    if (!h3) {
      // The node-server preset always exposes the h3 app; without it the body
      // limit cannot be installed — loud, content-free (never silent).
      getLogger().error(
        '[request-guard] nitroApp.h3 unavailable — body-limit guard NOT installed',
      )
    } else {
      const previousError = h3.config.onError
      h3.config.onError = (error, event) => {
        if (error instanceof PayloadTooLargeError) return error.response
        return previousError?.(error, event)
      }
      const previous = h3.config.onRequest
      h3.config.onRequest = (event) => {
        const limitBytes = bodyLimitFor(
          pathnameOf(event.req),
          opts.bodyLimitBytes,
          opts.pathBodyLimits,
        )
        const contentLength = event.req.headers.get('content-length')
        const refuse = (rejection: Response): never => {
          getLogger().warn(
            { contentLength, limitBytes },
            '[request-guard] body limit exceeded — 413',
          )
          throw new PayloadTooLargeError(rejection)
        }
        const declaredRejection = bodyLimitRejection(contentLength, limitBytes)
        if (declaredRejection) refuse(declaredRejection)
        // A body with a declared length is left unread: its handler reads it
        // after its own checks. Only an undeclared length needs counting.
        if (contentLength !== null || !event.req.body) return previous?.(event)
        return bodyExceedsLimit(event.req, limitBytes).then((exceeded) => {
          if (exceeded) refuse(payloadTooLarge())
          return previous?.(event)
        })
      }
    }

    nitroApp.hooks.hook('response', (res, event) => {
      res.headers.set(
        'x-request-id',
        resolveRequestId(event.req.headers.get('x-request-id'), idGen),
      )
    })
  }
}
