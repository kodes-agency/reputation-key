// Integration context — AES-256-GCM token encryption adapter
// Per architecture: factory function returning TokenEncryptionPort.
// Format: iv:authTag:ciphertext (base64 encoded parts)

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { getEnv } from '#/shared/config/env'
import type { TokenEncryptionPort } from '../../application/ports/token-encryption.port'

export const createTokenEncryptionAdapter = (): TokenEncryptionPort => {
  const key = Buffer.from(getEnv().ENCRYPTION_KEY, 'hex')

  const encrypt = (plaintext: string): string => {
    const iv = randomBytes(12) // 12 bytes for GCM (recommended)
    const cipher = createCipheriv('aes-256-gcm', key, iv)

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

    const authTag = cipher.getAuthTag()

    // Format: iv:authTag:ciphertext (all base64 encoded)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
  }

  const decrypt = (ciphertext: string): string => {
    const parts = ciphertext.split(':')
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format: expected iv:authTag:ciphertext')
    }
    const [ivBase64, authTagBase64, encryptedBase64] = parts

    const iv = Buffer.from(ivBase64, 'base64')
    const authTag = Buffer.from(authTagBase64, 'base64')
    const encrypted = Buffer.from(encryptedBase64, 'base64')

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

    return decrypted.toString('utf8')
  }

  return { encrypt, decrypt }
}
