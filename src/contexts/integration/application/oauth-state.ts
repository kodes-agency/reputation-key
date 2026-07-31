// Integration context — OAuth state security codec (BQC-7.6).
//
// Single source of truth for the custom Google OAuth flow's redirect-leg
// protection. Two controls:
//
//   1. HMAC-signed state, bound to the initiating user. The payload
//      {visibility, nonce, ts, sub} is signed with OAUTH_STATE_SECRET; the
//      callback rejects when `sub` does not match the session user, so a
//      state minted for one account cannot be replayed into another
//      (login-CSRF / account-confusion). States without `sub` (pre-BQC-7.6
//      issues, ≤10 min in-flight across a deploy) fail closed.
//
//   2. PKCE (RFC 7636, S256). The issuer generates a high-entropy verifier,
//      stores it server-side keyed by the state nonce (TTL = state TTL,
//      one-time use — see the PkceVerifierStore implementations), and sends
//      only the challenge. The callback redeems and forwards the verifier on
//      the token exchange; an intercepted auth code is useless without it.
//
// Both sides sign/verify through THIS module — the use case
// (get-google-auth-url) and the callback route never re-implement the codec.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { err, ok, type Result } from '#/shared/domain'

/** State freshness window — 10 minutes. The PKCE verifier TTL matches. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const OAUTH_STATE_TTL_SECONDS = OAUTH_STATE_TTL_MS / 1000

export type OAuthStatePayload = Readonly<{
  visibility: 'private' | 'organization'
  nonce: string
  ts: number
  /** Subject — the initiating user's id (session binding). */
  sub: string
}>

export type OAuthStateRejection =
  | 'malformed'
  | 'missing_fields'
  | 'expired'
  | 'invalid_visibility'
  | 'bad_signature'
  | 'user_mismatch'

/**
 * Server-side store for PKCE verifiers, keyed by the OAuth state nonce.
 * Implementations: Redis (production) and in-memory (dev fallback) in
 * infrastructure/repositories/pkce-verifier-store.repository.ts.
 */
export type PkceVerifierStore = Readonly<{
  /** Persist the verifier under the nonce with a TTL (seconds). */
  save: (nonce: string, verifier: string, ttlSeconds: number) => Promise<void>
  /** One-time read: returns the verifier and deletes it. Unknown → undefined. */
  redeem: (nonce: string) => Promise<string | undefined>
}>

/** HMAC-sign the canonical payload JSON (single construction site). */
function signPayload(payload: OAuthStatePayload, secret: string): string {
  const canonical = {
    visibility: payload.visibility,
    nonce: payload.nonce,
    ts: payload.ts,
    sub: payload.sub,
  }
  return createHmac('sha256', secret).update(JSON.stringify(canonical)).digest('hex')
}

/** Encode a signed state for the authorization URL. */
export function encodeOAuthState(payload: OAuthStatePayload, secret: string): string {
  const signature = signPayload(payload, secret)
  return Buffer.from(JSON.stringify({ ...payload, signature })).toString('base64')
}

/**
 * Parse and validate an inbound state: base64+JSON shape, required fields,
 * freshness, visibility enum, HMAC signature (constant-time), and the
 * session-user binding. Every rejection is final — callers fail closed.
 */
export function verifyOAuthState(
  rawState: string,
  opts: Readonly<{
    secret: string
    expectedUserId: string
    nowMs: number
    maxAgeMs?: number
  }>,
): Result<OAuthStatePayload, OAuthStateRejection> {
  let parsed: {
    visibility?: string
    nonce?: string
    ts?: number
    sub?: string
    signature?: string
  }
  try {
    parsed = JSON.parse(Buffer.from(rawState, 'base64').toString())
  } catch {
    return err('malformed')
  }

  if (!parsed.signature || !parsed.nonce || !parsed.ts || !parsed.sub) {
    return err('missing_fields')
  }

  const maxAgeMs = opts.maxAgeMs ?? OAUTH_STATE_TTL_MS
  if (opts.nowMs - parsed.ts > maxAgeMs) {
    return err('expired')
  }

  if (parsed.visibility !== 'private' && parsed.visibility !== 'organization') {
    return err('invalid_visibility')
  }

  const payload: OAuthStatePayload = {
    visibility: parsed.visibility,
    nonce: parsed.nonce,
    ts: parsed.ts,
    sub: parsed.sub,
  }
  const expectedSignature = signPayload(payload, opts.secret)
  if (
    parsed.signature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(parsed.signature), Buffer.from(expectedSignature))
  ) {
    return err('bad_signature')
  }

  if (parsed.sub !== opts.expectedUserId) {
    return err('user_mismatch')
  }

  return ok(payload)
}

/** Generate a PKCE code verifier: 48 random bytes → 64 base64url chars. */
export function generateCodeVerifier(): string {
  return randomBytes(48).toString('base64url')
}

/** PKCE S256 challenge: base64url(SHA-256(verifier)). */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
