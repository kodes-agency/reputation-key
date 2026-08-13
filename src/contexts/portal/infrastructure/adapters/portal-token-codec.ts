import { createHmac, randomBytes } from 'node:crypto'
import type {
  PortalTokenCodec,
  PortalTokenDigest,
} from '../../application/ports/portal-token-codec.port'

const TOKEN_PATTERN = /^pt_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/

export function createPortalTokenCodec(input: {
  secret: string
  keyVersion?: number
  randomBytes?: (size: number) => Buffer
}): PortalTokenCodec {
  if (Buffer.byteLength(input.secret, 'utf8') < 32) {
    throw new Error('PORTAL_TOKEN_HASH_SECRET must contain at least 32 bytes')
  }
  const keyVersion = input.keyVersion ?? 1
  const secureRandomBytes = input.randomBytes ?? randomBytes

  const digest = (rawToken: string): PortalTokenDigest | null => {
    const match = TOKEN_PATTERN.exec(rawToken)
    if (!match) return null
    return {
      tokenIdentifier: match[1],
      tokenHash: createHmac('sha256', input.secret).update(rawToken).digest('hex'),
      tokenKeyVersion: keyVersion,
    }
  }

  return {
    issue: () => {
      const tokenIdentifier = secureRandomBytes(12).toString('base64url')
      const secret = secureRandomBytes(32).toString('base64url')
      const rawToken = `pt_${tokenIdentifier}_${secret}`
      const tokenDigest = digest(rawToken)
      if (!tokenDigest) throw new Error('generated portal token is malformed')
      return { rawToken, ...tokenDigest }
    },
    digest,
  }
}
