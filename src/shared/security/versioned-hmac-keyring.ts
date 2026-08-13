import { createHmac, timingSafeEqual } from 'node:crypto'

export type VersionedHmacKeyring = Readonly<{
  activeVersion: string
  retainedVersions: readonly string[]
  sign: (
    audience: string,
    value: string,
  ) => Readonly<{ keyVersion: string; digest: string }>
  verify: (audience: string, value: string, keyVersion: string, digest: string) => boolean
  derive: (audience: string, value: string, keyVersion: string) => string | null
}>

const ENTRY = /^([a-z][a-z0-9_-]{0,31}):([a-f0-9]{64})$/

export function createVersionedHmacKeyring(raw: string): VersionedHmacKeyring {
  const entries = raw.split(',').map((entry) => entry.trim())
  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    throw new Error('HMAC keyring is empty or malformed')
  }
  const keys = new Map<string, Buffer>()
  for (const entry of entries) {
    const match = ENTRY.exec(entry)
    if (!match) throw new Error('HMAC keyring entry is malformed')
    const [, version, hexKey] = match
    if (keys.has(version!)) throw new Error('HMAC keyring version is duplicated')
    keys.set(version!, Buffer.from(hexKey!, 'hex'))
  }
  const activeVersion = entries[0]!.split(':', 1)[0]!
  const retainedVersions = Object.freeze([...keys.keys()].slice(1))

  const digestFor = (audience: string, value: string, key: Buffer) =>
    createHmac('sha256', key)
      .update(audience, 'utf8')
      .update('\0', 'utf8')
      .update(value, 'utf8')
      .digest('base64url')

  return Object.freeze({
    activeVersion,
    retainedVersions,
    sign: (audience, value) => ({
      keyVersion: activeVersion,
      digest: digestFor(audience, value, keys.get(activeVersion)!),
    }),
    derive: (audience, value, keyVersion) => {
      const key = keys.get(keyVersion)
      return key ? digestFor(audience, value, key) : null
    },
    verify: (audience, value, keyVersion, digest) => {
      const key = keys.get(keyVersion)
      if (!key || !/^[A-Za-z0-9_-]{43}$/.test(digest)) return false
      const expected = Buffer.from(digestFor(audience, value, key))
      const actual = Buffer.from(digest)
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    },
  })
}
