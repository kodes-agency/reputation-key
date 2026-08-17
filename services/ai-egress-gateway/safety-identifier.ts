import { createHash, createHmac } from 'node:crypto'

const SAFETY_DOMAIN = 'repkey-ai-safety-identifier-v1\0'
const CANARY_DOMAIN = 'repkey-synthetic-canary-safety-v1\0'
const encoder = new TextEncoder()

function containsControlCharacter(value: string): boolean {
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true
    }
  }
  return false
}

function assertIdentifier(value: string, field: string): void {
  const bytes = encoder.encode(value)
  if (bytes.byteLength < 1 || bytes.byteLength > 255 || containsControlCharacter(value)) {
    throw new TypeError(`Invalid ${field} for AI safety identifier`)
  }
}

function appendLengthPrefixed(hmac: ReturnType<typeof createHmac>, value: string): void {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(bytes.byteLength)
  hmac.update(length)
  hmac.update(bytes)
  length.fill(0)
}

export type PropertySafetyIdentifierInput =
  | Readonly<{
      kind: 'system'
      organizationId: string
      propertyId: string
      key: Uint8Array
    }>
  | Readonly<{
      kind: 'interactive'
      organizationId: string
      propertyId: string
      actorId: string
      key: Uint8Array
    }>

export function derivePropertySafetyIdentifier(
  input: PropertySafetyIdentifierInput,
): `rk1_${string}` {
  assertIdentifier(input.organizationId, 'organizationId')
  assertIdentifier(input.propertyId, 'propertyId')
  if (input.kind === 'interactive') assertIdentifier(input.actorId, 'actorId')
  if (input.key.byteLength < 32)
    throw new TypeError('AI safety identifier key is too short')
  const hmac = createHmac('sha256', input.key).update(SAFETY_DOMAIN, 'utf8')
  appendLengthPrefixed(hmac, input.kind)
  appendLengthPrefixed(hmac, input.organizationId)
  appendLengthPrefixed(hmac, input.propertyId)
  if (input.kind === 'interactive') appendLengthPrefixed(hmac, input.actorId)
  return `rk1_${hmac.digest('base64url')}`
}

const CANARY_SAFETY_IDENTIFIER = `rk1_${createHash('sha256')
  .update(CANARY_DOMAIN, 'utf8')
  .digest('base64url')}` as const

export function deriveCanarySafetyIdentifier(): typeof CANARY_SAFETY_IDENTIFIER {
  return CANARY_SAFETY_IDENTIFIER
}
