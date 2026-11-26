import { createHmac } from 'node:crypto'

/**
 * A keyed digest of `value` that stands in for it where the value itself must
 * not be stored. The domain separates uses of one secret, so two domains never
 * yield a linkable pseudonym for the same value; it is hashed with a NUL after
 * it so no domain is a prefix of another.
 */
export function keyedPseudonym(secret: string, domain: string, value: string): string {
  return createHmac('sha256', secret).update(`${domain}\0`).update(value).digest('hex')
}
