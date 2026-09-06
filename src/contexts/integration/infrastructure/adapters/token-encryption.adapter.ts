// Integration context — AES-256-GCM token encryption adapter.
// Per architecture: factory function returning TokenEncryptionPort.
//
// Ciphertext format: `<version>:<iv>:<authTag>:<ciphertext>`, the last three
// base64. The version prefix is what makes a key rotation possible at all: it
// names which key sealed this row, so a new key can become active while rows
// sealed by the previous one are still readable. Without it, rotating the key
// means every existing ciphertext decrypts to garbage — or, worse, fails the
// GCM tag check and is indistinguishable from tampering.
//
// The version is also bound as additional authenticated data, so an attacker
// cannot relabel a ciphertext to point at a different key and have the tag
// still verify.
//
// There is deliberately no support for the legacy three-part format. The
// database is disposable in this beta, so there are no unversioned rows to
// read, and accepting them would mean accepting a ciphertext whose key is a
// guess.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import type { TokenEncryptionPort } from '../../application/ports/token-encryption.port'
import { integrationError } from '../../domain/errors'

export type TokenEncryptionConfig = Readonly<{
  /** Version whose key seals every NEW ciphertext. */
  activeVersion: string
  /** Every key that may still be needed to READ, by version. Hex, 32 bytes. */
  keys: Readonly<Record<string, string>>
}>

export const createTokenEncryptionAdapter = (
  config: TokenEncryptionConfig,
): TokenEncryptionPort => {
  const keys = new Map<string, Buffer>()
  for (const [version, hex] of Object.entries(config.keys)) {
    const key = Buffer.from(hex, 'hex')
    if (key.length !== 32 || version.length === 0 || version.includes(':')) {
      // F147: sanitized — never leak key length, format, or version names.
      throw integrationError('encryption_error', 'Invalid encryption key configuration')
    }
    keys.set(version, key)
  }
  const activeKey = keys.get(config.activeVersion)
  if (!activeKey) {
    throw integrationError('encryption_error', 'Invalid encryption key configuration')
  }

  const encrypt = (plaintext: string): string => {
    const iv = randomBytes(12) // 12 bytes for GCM (recommended)
    const cipher = createCipheriv('aes-256-gcm', activeKey, iv)
    cipher.setAAD(Buffer.from(config.activeVersion, 'utf8'))

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    return [
      config.activeVersion,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':')
  }

  const decrypt = (ciphertext: string): string => {
    const parts = ciphertext.split(':')
    if (parts.length !== 4) {
      // F147: sanitized — do not reveal the expected ciphertext format.
      throw integrationError('encryption_error', 'Invalid ciphertext format')
    }
    const [version, ivBase64, authTagBase64, encryptedBase64] = parts as [
      string,
      string,
      string,
      string,
    ]

    const key = keys.get(version)
    if (!key) {
      throw integrationError('encryption_error', 'Unknown key version')
    }

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'))
    decipher.setAAD(Buffer.from(version, 'utf8'))
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'))

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64')),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  }

  return { encrypt, decrypt }
}
