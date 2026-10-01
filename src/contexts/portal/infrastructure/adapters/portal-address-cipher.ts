// Portal address cipher (round 4, slice 33; ADR 0064).
//
// AES-256-GCM over the raw public address, with the row it belongs to as
// authenticated data. Ciphertext layout `iv:tag:ciphertext`, each part base64.
// This is the third ciphertext format in the tree, beside guest contact
// requests and Google OAuth tokens; it is registered as an owner in
// `ciphertext-format-singleton.test.ts`, and nothing else may build or parse it.
//
// The keyring is `<version>:<64 lowercase hex>[,...]`. The first entry seals;
// every entry opens, so a key can be rotated in and the old one retired later.
// The version is an integer because it is stored beside the ciphertext in
// `portal_tokens.address_encryption_key_version`.

import { createCipheriv, createDecipheriv } from 'node:crypto'
import type {
  PortalAddressCipher,
  PortalAddressContext,
  SealedPortalAddress,
} from '../../application/ports/portal-address-cipher.port'

const FORMAT = 'portal-address-v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_KEYS = 4
const ENTRY_PATTERN = /^([1-9]\d{0,3}):([a-f0-9]{64})$/
const RAW_TOKEN_PATTERN = /^pt_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/

/** Carries no address, key or ciphertext: a failure must not leak what it guards. */
export class PortalAddressCipherError extends Error {
  constructor() {
    super('Portal address is unavailable')
    this.name = 'PortalAddressCipherError'
  }
}

export type PortalAddressKeyring = Readonly<{
  activeVersion: number
  keys: ReadonlyMap<number, Buffer>
}>

export function parsePortalAddressKeyring(value: string): PortalAddressKeyring {
  const entries = value.split(',')
  if (entries.length > MAX_KEYS) throw new PortalAddressCipherError()
  const keys = new Map<number, Buffer>()
  let activeVersion: number | null = null
  for (const entry of entries) {
    const match = ENTRY_PATTERN.exec(entry)
    if (!match) throw new PortalAddressCipherError()
    const [, versionText, material] = match
    if (versionText === undefined || material === undefined) {
      throw new PortalAddressCipherError()
    }
    const version = Number(versionText)
    if (keys.has(version)) throw new PortalAddressCipherError()
    keys.set(version, Buffer.from(material, 'hex'))
    activeVersion ??= version
  }
  if (activeVersion === null) throw new PortalAddressCipherError()
  return Object.freeze({ activeVersion, keys })
}

function additionalData(context: PortalAddressContext): Buffer {
  return Buffer.from(
    JSON.stringify([
      FORMAT,
      context.organizationId,
      context.propertyId,
      context.portalId,
      context.tokenId,
      context.version,
    ]),
    'utf8',
  )
}

export const createPortalAddressCipher = (
  input: Readonly<{ keyring: string; generateIv: () => Buffer }>,
): PortalAddressCipher => {
  const { activeVersion, keys } = parsePortalAddressKeyring(input.keyring)

  const seal = (rawToken: string, context: PortalAddressContext): SealedPortalAddress => {
    try {
      const key = keys.get(activeVersion)
      const iv = input.generateIv()
      if (!key || iv.length !== IV_BYTES || !RAW_TOKEN_PATTERN.test(rawToken)) {
        throw new PortalAddressCipherError()
      }
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(additionalData(context))
      const encrypted = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return Object.freeze({
        keyVersion: activeVersion,
        ciphertext: [iv, tag, encrypted].map((part) => part.toString('base64')).join(':'),
      })
    } catch {
      throw new PortalAddressCipherError()
    }
  }

  const open = (sealed: SealedPortalAddress, context: PortalAddressContext): string => {
    try {
      const key = keys.get(sealed.keyVersion)
      const parts = sealed.ciphertext.split(':')
      if (!key || parts.length !== 3) throw new PortalAddressCipherError()
      const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64'))
      if (
        !iv ||
        !tag ||
        !encrypted ||
        iv.length !== IV_BYTES ||
        tag.length !== TAG_BYTES ||
        encrypted.length === 0
      ) {
        throw new PortalAddressCipherError()
      }
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(additionalData(context))
      decipher.setAuthTag(tag)
      const rawToken = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8')
      if (!RAW_TOKEN_PATTERN.test(rawToken)) throw new PortalAddressCipherError()
      return rawToken
    } catch {
      throw new PortalAddressCipherError()
    }
  }

  return Object.freeze({ seal, open, canOpen: (keyVersion) => keys.has(keyVersion) })
}
