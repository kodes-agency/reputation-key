import { createPrivateKey, timingSafeEqual, type KeyObject } from 'node:crypto'
import {
  decodeCanonicalBase64KeyMaterial,
  loadNamedEd25519PublicKeyring,
} from '#/shared/ed25519-key-material'
import { AI_GATEWAY_KEY_INVENTORY_V1 } from '#/shared/ai-openai-provider-profile'

const SAFETY_KEY = /^([a-z][a-z0-9_-]{0,31}):([a-f0-9]{64})$/
const ED25519_PKCS8_BYTES = 48

export function loadEd25519PrivateKey(encoded: string): KeyObject {
  const bytes = decodeCanonicalBase64KeyMaterial(encoded)
  try {
    if (bytes.byteLength !== ED25519_PKCS8_BYTES) throw new Error('wrong key length')
    const key = createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' })
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type')
    const canonical = Buffer.from(key.export({ format: 'der', type: 'pkcs8' }))
    try {
      if (
        canonical.byteLength !== ED25519_PKCS8_BYTES ||
        !timingSafeEqual(canonical, bytes)
      )
        throw new Error('noncanonical key')
    } finally {
      canonical.fill(0)
    }
    return key
  } catch {
    throw new Error('AI gateway private key is invalid')
  } finally {
    bytes.fill(0)
  }
}

export function loadEd25519PublicKeyring(
  encodedJson: string,
): ReadonlyMap<string, KeyObject> {
  const inventory = AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning
  return loadNamedEd25519PublicKeyring(
    encodedJson,
    [inventory.activeKid, ...inventory.retainedKids],
    inventory.maximumConfiguredKeys,
  )
}

export function loadSafetyIdentifierKey(encoded: string): Readonly<{
  version: string
  key: Buffer
}> {
  const match = SAFETY_KEY.exec(encoded)
  if (!match) throw new Error('AI safety identifier key is invalid')
  return Object.freeze({ version: match[1]!, key: Buffer.from(match[2]!, 'hex') })
}
