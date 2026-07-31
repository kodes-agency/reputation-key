// In-memory PkceVerifierStore fake — for use in use case tests.
// One-time redeem semantics mirror the production Redis store; TTL is
// accepted but not enforced (unit tests control redemption order).

import type { PkceVerifierStore } from '#/contexts/integration/application/oauth-state'

export type InMemoryPkceVerifierStore = PkceVerifierStore &
  Readonly<{
    /** All save calls in order (nonce, verifier, ttlSeconds). */
    saves: () => ReadonlyArray<{ nonce: string; verifier: string; ttlSeconds: number }>
  }>

export const createInMemoryPkceVerifierStore = (): InMemoryPkceVerifierStore => {
  const entries = new Map<string, string>()
  const saveCalls: Array<{ nonce: string; verifier: string; ttlSeconds: number }> = []

  return {
    save: async (nonce, verifier, ttlSeconds) => {
      saveCalls.push({ nonce, verifier, ttlSeconds })
      entries.set(nonce, verifier)
    },
    redeem: async (nonce) => {
      const verifier = entries.get(nonce)
      entries.delete(nonce)
      return verifier
    },
    saves: () => [...saveCalls],
  }
}
