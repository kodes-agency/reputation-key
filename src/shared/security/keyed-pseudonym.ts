import { createHmac } from 'node:crypto'

/**
 * A stable pseudonym of `value` under a secret and a domain string: the same
 * value gets a different pseudonym in each domain, so keys built for one
 * purpose cannot be correlated with another.
 */
export function keyedPseudonym(secret: string, domain: string, value: string): string {
  return createHmac('sha256', secret).update(`${domain}\0`).update(value).digest('hex')
}
