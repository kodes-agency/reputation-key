import { createPrivateKey, timingSafeEqual, type KeyObject } from 'node:crypto'

const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const ED25519_PKCS8_BYTES = 48

export function loadEd25519PrivateKey(
  encoded: string,
  importer: typeof createPrivateKey = createPrivateKey,
): KeyObject {
  if (
    encoded.length < 1 ||
    encoded.length > 16 * 1024 ||
    !CANONICAL_BASE64.test(encoded)
  ) {
    throw new Error('AI admission signing key is invalid')
  }
  const bytes = Buffer.from(encoded, 'base64')
  try {
    if (
      bytes.byteLength !== ED25519_PKCS8_BYTES ||
      bytes.toString('base64') !== encoded
    ) {
      throw new Error('AI admission signing key is invalid')
    }
    const key = importer({ key: bytes, format: 'der', type: 'pkcs8' })
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error('AI admission signing key is invalid')
    }
    const canonical = Buffer.from(key.export({ format: 'der', type: 'pkcs8' }))
    try {
      if (
        canonical.byteLength !== ED25519_PKCS8_BYTES ||
        !timingSafeEqual(canonical, bytes)
      )
        throw new Error('AI admission signing key is invalid')
    } finally {
      canonical.fill(0)
    }
    return key
  } catch {
    throw new Error('AI admission signing key is invalid')
  } finally {
    bytes.fill(0)
  }
}
