import { createHmac } from 'node:crypto'

/**
 * A stable, content-free stand-in for `value`: a hex HMAC-SHA-256 over the
 * domain string and then the value. The domain (include its trailing `\0`)
 * keeps one use's stand-ins from matching another's; changing a domain or the
 * secret changes every stand-in made under it.
 */
export const keyedPseudonym = (secret: string, domain: string, value: string): string =>
  createHmac('sha256', secret).update(domain).update(value).digest('hex')
