import {
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto'
import { z } from 'zod/v4'
import { parseAiInternalJsonBytes } from '#/shared/ai-internal-transport-contract'
import { AI_GATEWAY_KEY_INVENTORY_V1 } from '#/shared/ai-openai-provider-profile'

const KEY_ID = /^[a-z][a-z0-9_-]{0,31}$/
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const SAFETY_KEY = /^([a-z][a-z0-9_-]{0,31}):([a-f0-9]{64})$/
const MAX_KEY_MATERIAL_ENCODED_BYTES = 16_384
const ED25519_PKCS8_BYTES = 48
const ED25519_SPKI_BYTES = 44

function decodeCanonicalBase64(encoded: string): Buffer {
  if (
    encoded.length < 1 ||
    encoded.length > MAX_KEY_MATERIAL_ENCODED_BYTES ||
    !CANONICAL_BASE64.test(encoded)
  ) {
    throw new Error('AI gateway key material is invalid')
  }
  const bytes = Buffer.from(encoded, 'base64')
  try {
    if (
      bytes.length === 0 ||
      bytes.length > MAX_KEY_MATERIAL_ENCODED_BYTES ||
      bytes.toString('base64') !== encoded
    ) {
      throw new Error('AI gateway key material is invalid')
    }
    return bytes
  } catch {
    bytes.fill(0)
    throw new Error('AI gateway key material is invalid')
  }
}

export function loadEd25519PrivateKey(encoded: string): KeyObject {
  const bytes = decodeCanonicalBase64(encoded)
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
  const jsonBytes = Buffer.from(encodedJson, 'utf8')
  let parsed: Record<string, string>
  try {
    parsed = parseAiInternalJsonBytes(jsonBytes, 65_536, z.record(z.string(), z.string()))
  } catch {
    throw new Error('AI gateway public keyring is invalid')
  } finally {
    jsonBytes.fill(0)
  }
  const entries = Object.entries(parsed)
  const expectedKids = [
    AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.activeKid,
    ...AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.retainedKids,
  ].sort()
  if (
    entries.length < 1 ||
    entries.length > AI_GATEWAY_KEY_INVENTORY_V1.admissionSigning.maximumConfiguredKeys ||
    entries
      .map(([kid]) => kid)
      .sort()
      .join('\0') !== expectedKids.join('\0')
  ) {
    throw new Error('AI gateway public keyring is invalid')
  }
  const keys = new Map<string, KeyObject>()
  for (const [kid, encoded] of entries) {
    if (!KEY_ID.test(kid) || typeof encoded !== 'string') {
      throw new Error('AI gateway public keyring is invalid')
    }
    const bytes = decodeCanonicalBase64(encoded)
    try {
      if (bytes.byteLength !== ED25519_SPKI_BYTES) throw new Error('wrong key length')
      const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' })
      if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type')
      const canonical = Buffer.from(key.export({ format: 'der', type: 'spki' }))
      try {
        if (
          canonical.byteLength !== ED25519_SPKI_BYTES ||
          !timingSafeEqual(canonical, bytes)
        )
          throw new Error('noncanonical key')
      } finally {
        canonical.fill(0)
      }
      keys.set(kid, key)
    } catch {
      throw new Error('AI gateway public keyring is invalid')
    } finally {
      bytes.fill(0)
    }
  }
  return keys
}

export function loadSafetyIdentifierKey(encoded: string): Readonly<{
  version: string
  key: Buffer
}> {
  const match = SAFETY_KEY.exec(encoded)
  if (!match) throw new Error('AI safety identifier key is invalid')
  return Object.freeze({ version: match[1]!, key: Buffer.from(match[2]!, 'hex') })
}
