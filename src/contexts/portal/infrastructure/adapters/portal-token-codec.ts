import { createHmac } from 'node:crypto'
import type {
  DerivedPrintCode,
  PortalTokenCodec,
  PortalTokenDigest,
} from '../../application/ports/portal-token-codec.port'
import type { PortalAccessArtifactChannel } from '../../domain/portal-access-artifact'
import { normalizePrintCode, printCodeFromBytes } from '../../domain/print-code'

const TOKEN_PATTERN = /^pt_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/

// Print codes (ADR 0069) use two subkeys of the server secret, one job each, so
// the key that makes a code never also makes the hash that is stored for it, and
// neither is the key behind the long address hash. The `/v1` is the format of
// the subkeys, not the secret's version: print codes are bound to the first
// secret for life, because every printed code would otherwise stop matching the
// hash stored for it. A dual-secret scheme must keep that secret for them.
const DERIVE_KEY_LABEL = 'rk-print-code-derive-key/v1'
const HASH_KEY_LABEL = 'rk-print-code-hash-key/v1'

// The artifact id sits between two separators in the derivation message.
const SEPARATOR = '|'

const hmacSha256 = (key: string | Buffer, message: string): Buffer =>
  createHmac('sha256', key).update(message).digest()

export const createPortalTokenCodec = (input: {
  secret: string
  keyVersion?: number
  randomBytes: (size: number) => Buffer
}): PortalTokenCodec => {
  if (Buffer.byteLength(input.secret, 'utf8') < 32) {
    throw new Error('PORTAL_TOKEN_HASH_SECRET must contain at least 32 bytes')
  }
  const keyVersion = input.keyVersion ?? 1
  const secureRandomBytes = input.randomBytes
  const deriveKey = hmacSha256(input.secret, DERIVE_KEY_LABEL)
  const hashKey = hmacSha256(input.secret, HASH_KEY_LABEL)

  const digest = (rawToken: string): PortalTokenDigest | null => {
    const match = TOKEN_PATTERN.exec(rawToken)
    if (!match) return null
    return {
      tokenIdentifier: match[1],
      tokenHash: createHmac('sha256', input.secret).update(rawToken).digest('hex'),
      tokenKeyVersion: keyVersion,
    }
  }

  const hashPrintCode = (printCode: string): string =>
    hmacSha256(hashKey, printCode).toString('hex')

  const derivePrintCode = (
    channel: PortalAccessArtifactChannel,
    accessArtifactId: string,
    rawToken: string,
  ): DerivedPrintCode => {
    const mac = hmacSha256(
      deriveKey,
      [channel, accessArtifactId, rawToken].join(SEPARATOR),
    )
    const printCode = printCodeFromBytes(mac)
    return { printCode, printCodeHash: hashPrintCode(printCode) }
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
    digestPrintCode: (raw) => {
      const printCode = normalizePrintCode(raw)
      return printCode === null ? null : { printCodeHash: hashPrintCode(printCode) }
    },
    isPrintCode: (raw) => normalizePrintCode(raw) !== null,
    derivePrintCodes: ({ rawToken, accessArtifactIds }) => {
      if (!TOKEN_PATTERN.test(rawToken)) return null
      const ids = [accessArtifactIds.qr, accessArtifactIds.nfc]
      if (ids.some((id) => id.length === 0 || id.includes(SEPARATOR))) return null
      return {
        qr: derivePrintCode('qr', accessArtifactIds.qr, rawToken),
        nfc: derivePrintCode('nfc', accessArtifactIds.nfc, rawToken),
      }
    },
  }
}
