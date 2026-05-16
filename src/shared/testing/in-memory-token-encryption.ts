// In-memory TokenEncryptionPort fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type { TokenEncryptionPort } from '#/contexts/integration/application/ports/token-encryption.port'

export const createInMemoryTokenEncryption = (): TokenEncryptionPort => ({
  encrypt: (plaintext: string) => `enc:${plaintext}`,
  decrypt: (ciphertext: string) => ciphertext.replace(/^enc:/, ''),
})
