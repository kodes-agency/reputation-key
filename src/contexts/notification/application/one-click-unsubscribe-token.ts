import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { absoluteUrl } from '#/shared/email/urls'

export const ONE_CLICK_UNSUBSCRIBE_PATH = '/api/notifications/unsubscribe'

const AUDIENCE = 'notification-one-click-unsubscribe-v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN = /^([a-z][a-z0-9_-]{0,31})\.([A-Za-z0-9_-]{1,512})\.([A-Za-z0-9_-]{43})$/

export type OneClickUnsubscribeTarget = Readonly<{
  kind: 'email' | 'digest'
  id: string
}>

function encodeTarget(target: OneClickUnsubscribeTarget): string {
  if (!UUID.test(target.id)) throw new Error('Unsubscribe target ID must be a UUID')
  return Buffer.from(
    JSON.stringify({ version: 1, kind: target.kind, id: target.id }),
    'utf8',
  ).toString('base64url')
}

export function createOneClickUnsubscribeToken(
  rawKeys: string,
  target: OneClickUnsubscribeTarget,
  keyVersion?: string,
): string {
  const payload = encodeTarget(target)
  const keys = createVersionedHmacKeyring(rawKeys)
  try {
    if (!keyVersion) {
      const signed = keys.sign(AUDIENCE, payload)
      return `${signed.keyVersion}.${payload}.${signed.digest}`
    }
    const digest = keys.derive(AUDIENCE, payload, keyVersion)
    if (!digest) {
      throw new Error(`Unsubscribe HMAC key version is unavailable: ${keyVersion}`)
    }
    return `${keyVersion}.${payload}.${digest}`
  } finally {
    keys.dispose()
  }
}

export function activeOneClickUnsubscribeKeyVersion(rawKeys: string): string {
  const keys = createVersionedHmacKeyring(rawKeys)
  try {
    return keys.activeVersion
  } finally {
    keys.dispose()
  }
}

export function verifyOneClickUnsubscribeToken(
  rawKeys: string,
  token: string,
): OneClickUnsubscribeTarget | null {
  const match = TOKEN.exec(token)
  if (!match) return null
  const [, keyVersion, payload, digest] = match
  const keys = createVersionedHmacKeyring(rawKeys)
  try {
    if (!keys.verify(AUDIENCE, payload!, keyVersion!, digest!)) return null
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as {
      version?: unknown
      kind?: unknown
      id?: unknown
    }
    if (
      decoded.version !== 1 ||
      (decoded.kind !== 'email' && decoded.kind !== 'digest') ||
      typeof decoded.id !== 'string' ||
      !UUID.test(decoded.id)
    ) {
      return null
    }
    return { kind: decoded.kind, id: decoded.id }
  } catch {
    return null
  } finally {
    keys.dispose()
  }
}

export function oneClickUnsubscribeUrl(
  baseUrl: string,
  rawKeys: string,
  target: OneClickUnsubscribeTarget,
  keyVersion?: string,
): string {
  return absoluteUrl(baseUrl, ONE_CLICK_UNSUBSCRIBE_PATH, {
    token: createOneClickUnsubscribeToken(rawKeys, target, keyVersion),
  })
}
