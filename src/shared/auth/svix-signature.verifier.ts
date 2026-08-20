// Shared auth — Svix webhook signature verification (Resend delivery events).
//
// Lives in shared/ for the same reason `pubsub-jwt.verifier.ts` does: webhook
// routes are in routes/ and must not import a context's infrastructure.
//
// Why hand-rolled rather than the `svix` package: the scheme is ~30 lines of
// HMAC and adding a dependency for it would pull a transitive tree into the
// server bundle for one function. The scheme itself is fully specified and
// stable:
//
//   headers   svix-id, svix-timestamp (seconds since epoch), svix-signature
//   signed    `${svix-id}.${svix-timestamp}.${rawBody}`
//   key       the `whsec_` prefix stripped, remainder base64-DECODED
//   algorithm HMAC-SHA256, signature base64
//   header    space-delimited `v1,<base64>` tokens — accept if ANY matches
//
// Three details are load-bearing and each is a real vulnerability if dropped:
//  1. The RAW body string. Re-serialising parsed JSON changes key order and
//     whitespace, and the signature covers bytes.
//  2. The five-minute timestamp window. Without it a captured request replays
//     forever — the signature never expires on its own.
//  3. Constant-time comparison. A byte-at-a-time compare leaks the expected
//     signature to a patient attacker.

import { createHmac, timingSafeEqual } from 'node:crypto'

export type SvixHeaders = Readonly<{
  id: string | null
  timestamp: string | null
  signature: string | null
}>

export type SvixVerificationFailure =
  | 'missing_headers'
  | 'malformed_timestamp'
  | 'timestamp_outside_window'
  | 'malformed_secret'
  | 'signature_mismatch'

export type SvixVerificationResult =
  | Readonly<{ ok: true; id: string }>
  | Readonly<{ ok: false; reason: SvixVerificationFailure }>

/** Svix's own tolerance. Requests outside it are treated as replays. */
export const SVIX_TOLERANCE_SECONDS = 300

/** Read the three Svix headers from a Request. */
export function svixHeaders(request: Request): SvixHeaders {
  return {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  }
}

function secretKey(signingSecret: string): Buffer | null {
  const encoded = signingSecret.startsWith('whsec_')
    ? signingSecret.slice('whsec_'.length)
    : signingSecret
  if (encoded === '') return null
  const key = Buffer.from(encoded, 'base64')
  return key.length > 0 ? key : null
}

/**
 * Verify a Svix-signed webhook. `rawBody` MUST be the exact string read off the
 * request, never a re-serialisation of parsed JSON.
 */
export function verifySvixSignature(
  input: Readonly<{
    rawBody: string
    headers: SvixHeaders
    signingSecret: string
    now?: Date
  }>,
): SvixVerificationResult {
  const { id, timestamp, signature } = input.headers
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' }

  const issuedAtSeconds = Number(timestamp)
  if (!Number.isFinite(issuedAtSeconds) || !Number.isInteger(issuedAtSeconds)) {
    return { ok: false, reason: 'malformed_timestamp' }
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  if (Math.abs(nowSeconds - issuedAtSeconds) > SVIX_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_outside_window' }
  }

  const key = secretKey(input.signingSecret)
  if (!key) return { ok: false, reason: 'malformed_secret' }

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${input.rawBody}`)
    .digest()

  // The header may carry several versioned signatures during a secret rotation.
  for (const token of signature.split(' ')) {
    const [version, value] = token.split(',')
    if (version !== 'v1' || !value) continue
    const candidate = Buffer.from(value, 'base64')
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true, id }
    }
  }
  return { ok: false, reason: 'signature_mismatch' }
}

/**
 * Produce a valid `svix-signature` header value. Exported for tests, and for a
 * local signing stub behind RESEND_BASE_URL — not used in request handling.
 */
export function signSvixPayload(
  input: Readonly<{ id: string; timestamp: string; rawBody: string; signingSecret: string }>,
): string {
  const key = secretKey(input.signingSecret)
  if (!key) throw new Error('Malformed Svix signing secret')
  const digest = createHmac('sha256', key)
    .update(`${input.id}.${input.timestamp}.${input.rawBody}`)
    .digest('base64')
  return `v1,${digest}`
}
