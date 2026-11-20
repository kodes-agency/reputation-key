// The production AES-256-GCM adapter keyed with a fixed test key, so tests
// seal and open tokens exactly as production does. Ciphertext carries a random
// nonce: assert on the opened token, never on the sealed string.

import type { TokenEncryptionPort } from '#/contexts/integration/connections/token-encryption.port.server'
import { createTokenEncryptionAdapter } from '#/contexts/integration/connections/token-encryption.adapter.server'

const TEST_KEY_HEX = '11'.repeat(32)

export const createTestTokenEncryption = (): TokenEncryptionPort =>
  createTokenEncryptionAdapter({ activeVersion: 'v1', keys: { v1: TEST_KEY_HEX } })
