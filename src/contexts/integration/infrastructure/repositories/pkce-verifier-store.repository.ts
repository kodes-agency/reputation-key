// Integration context — PKCE verifier store (BQC-7.6).
//
// Server-side storage for OAuth PKCE verifiers, keyed by the OAuth state
// nonce. The verifier is the secret half of the RFC 7636 pair: it must never
// leave the server until the token exchange, and each flow must be redeemable
// exactly once.
//
//   - createRedisPkceVerifierStore — production implementation. One-time use
//     is atomic via GETDEL; the TTL matches the OAuth state lifetime so a
//     never-completed flow's verifier evaporates with it.
//   - createInMemoryPkceVerifierStore — dev/test fallback when Redis is
//     absent (single-process only; composition logs the downgrade).

import type { Redis } from 'ioredis'
import type { PkceVerifierStore } from '../../application/oauth-state'

/** Redis key prefix for PKCE verifiers (nonce appended). */
export const PKCE_STORE_KEY_PREFIX = 'oauth:pkce:'

/** Redis-backed store: SET with EX on save, atomic GETDEL on redeem. */
export const createRedisPkceVerifierStore = (redis: Redis): PkceVerifierStore => ({
  save: async (nonce, verifier, ttlSeconds) => {
    await redis.set(`${PKCE_STORE_KEY_PREFIX}${nonce}`, verifier, 'EX', ttlSeconds)
  },
  redeem: async (nonce) => {
    // GETDEL is atomic: a replayed/concurrent redeem of the same nonce loses.
    const verifier = await redis.getdel(`${PKCE_STORE_KEY_PREFIX}${nonce}`)
    return verifier ?? undefined
  },
})

/**
 * In-memory store for development without Redis. Process-local: unsuitable
 * for multi-instance deployments (the callback may land on another process).
 */
export const createInMemoryPkceVerifierStore = (
  nowMs: () => number = () => Date.now(),
): PkceVerifierStore => {
  const entries = new Map<string, { verifier: string; expiresAtMs: number }>()
  return {
    save: async (nonce, verifier, ttlSeconds) => {
      entries.set(nonce, { verifier, expiresAtMs: nowMs() + ttlSeconds * 1000 })
    },
    redeem: async (nonce) => {
      const entry = entries.get(nonce)
      entries.delete(nonce)
      if (!entry || entry.expiresAtMs <= nowMs()) return undefined
      return entry.verifier
    },
  }
}
