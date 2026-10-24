// The real token codec for a test, with a fixed secret and, where a test must
// control the long address, a chosen one. Print codes (ADR 0069) are derived
// from the long address and the access-artifact ids, so a test that checks what
// a manager is handed needs the real derivation, not a stub.

import { createPortalTokenCodec } from '../adapters/portal-token-codec'
import type { PortalTokenCodec } from '../../application/ports/portal-token-codec.port'

/** 40 bytes, over the codec's 32-byte floor. */
const TEST_PORTAL_TOKEN_SECRET = 'print-code-test-secret-0123456789abcdef'

/**
 * The real codec. Without `nextRawToken` it issues deterministic long addresses
 * (the n-th one is built from bytes of value n). With it, `issue()` answers the
 * given address, which must be a well-formed long one.
 */
export function testPortalTokenCodec(nextRawToken?: () => string): PortalTokenCodec {
  let counter = 0
  const real = createPortalTokenCodec({
    secret: TEST_PORTAL_TOKEN_SECRET,
    randomBytes: (size) => Buffer.alloc(size, (counter += 1)),
  })
  if (nextRawToken === undefined) return real
  return {
    ...real,
    issue: () => {
      const rawToken = nextRawToken()
      const digest = real.digest(rawToken)
      if (digest?.kind !== 'long')
        throw new Error('The test address is not a long address')
      return {
        rawToken,
        tokenIdentifier: digest.tokenIdentifier,
        tokenHash: digest.tokenHash,
        tokenKeyVersion: digest.tokenKeyVersion,
      }
    },
  }
}
