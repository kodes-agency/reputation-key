import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './canonical-json'

/**
 * The one digest rule for AI profiles and the artifacts they attest: SHA-256 over
 * the domain string, then the RFC 8785 form of the value, as lowercase hex.
 * Stored operations and admission carry these digests, so the bytes never change.
 */
export function digestOf(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}
