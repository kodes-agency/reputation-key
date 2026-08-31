// Request guard — BQC-7.6 request-boundary hardening (body limit + request id).
//
// Two controls wired as one nitro v3 plugin (server/plugins/request-guard.ts):
//
//   1. Body-size limit — requests whose declared content-length exceeds
//      REQUEST_BODY_LIMIT_BYTES are rejected 413 BEFORE routing or body reads.
//      Mechanism: the nitro `request` runtime hook CANNOT short-circuit (nitro
//      routes hook errors into captureError and lets the request through —
//      verified against nitro's runtime app.mjs), so the guard wraps the h3
//      app's config.onRequest directly. A thrown web `Response` bypasses the
//      h3 error handler (prepareResponse returns non-ok Response instances
//      as-is — no stack/error page) and still flows through the response hook
//      chain, so the 413 carries the B0.7 headers and a request id too.
//      Chunked bodies without a declared length cannot be pre-empted here;
//      the platform gateway is the documented backstop (runbook).
//
//   2. x-request-id — honored when the inbound id is sane (bounded length,
//      header-safe charset), generated otherwise; set on EVERY response via
//      the nitro `response` hook. `requestId` is an approved correlation
//      field (BQC-7.3 metrics schema).
//
// The pure decisions live here (unit-tested); the plugin file is thin wiring.

import type { NitroAppPlugin } from 'nitro/types'
import { getLogger } from '#/shared/observability/logger'
import {
  DATA_CELL_CATALOGUE,
  DATA_CELL_IDS,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'

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
  return new Response(JSON.stringify({ error: 'payload_too_large' }), {
    status: 413,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Reject a request sent to another Data Cell's canonical hostname. Unknown
 * hosts (Railway private/public service domains, localhost, preview domains)
 * are left to the normal host/auth controls; a KNOWN cell domain may never
 * fall through to a differently declared process.
 */
export function dataCellHostRejection(
  host: string | null | undefined,
  localCell: DataCellId,
): Response | undefined {
  if (!host) return undefined
  const normalized = host.trim().toLowerCase().replace(/:\d+$/u, '')
  const targetCell = DATA_CELL_IDS.find(
    (cellId) => DATA_CELL_CATALOGUE[cellId].domain === normalized,
  )
  if (!targetCell || targetCell === localCell) return undefined
  return new Response(JSON.stringify({ error: 'wrong_cell' }), {
    status: 421,
    headers: { 'content-type': 'application/json' },
  })
}

export type RequestGuardOptions = Readonly<{
  /** Maximum accepted request body size in bytes (declared content-length). */
  bodyLimitBytes: number
  /** Id generator for requests without a sane inbound id (tests inject). */
  idGen?: () => string
  /** REG-01 request-edge host fence; production wiring always supplies it. */
  localCell?: DataCellId
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
      const previous = h3.config.onRequest
      h3.config.onRequest = (event) => {
        const hostRejection = opts.localCell
          ? dataCellHostRejection(
              event.req.headers.get('host') ?? new URL(event.req.url).host,
              opts.localCell,
            )
          : undefined
        if (hostRejection) {
          getLogger().warn(
            { localCell: opts.localCell },
            '[request-guard] canonical Data Cell host mismatch — 421',
          )
          throw hostRejection
        }
        const rejection = bodyLimitRejection(
          event.req.headers.get('content-length'),
          opts.bodyLimitBytes,
        )
        if (rejection) {
          getLogger().warn(
            {
              contentLength: event.req.headers.get('content-length'),
              limitBytes: opts.bodyLimitBytes,
            },
            '[request-guard] body limit exceeded — 413',
          )
          throw rejection
        }
        return previous?.(event)
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
