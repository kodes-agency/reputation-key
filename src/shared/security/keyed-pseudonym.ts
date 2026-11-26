import { createHmac } from 'node:crypto'

/**
 * A content-free stand-in for `value`: the hex HMAC-SHA-256 of it under `secret`,
 * separated by `domain` so two uses of the same value never correlate. A domain
 * is part of the digest: changing one changes every key already stored.
 */
export function keyedPseudonym(secret: string, domain: string, value: string): string {
  return createHmac('sha256', secret).update(`${domain}\0`).update(value).digest('hex')
}
