import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import type { Env } from '#/shared/config/env'
import { createAiEgressRuntime } from './ai-egress-runtime'

// The local-stack signing inventory (`AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1`)
// pins the two RFC 8032 test keys, the same ones `e2e/stack.env` carries.
const ADMISSION_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
const PROVENANCE_SEED = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb'

function pkcs8Base64(seed: string): string {
  return Buffer.from(`302e020100300506032b657004220420${seed}`, 'hex').toString('base64')
}

function publicKeyring(kid: string, seed: string): string {
  const publicKey = createPublicKey(
    createPrivateKey({
      key: Buffer.from(`302e020100300506032b657004220420${seed}`, 'hex'),
      format: 'der',
      type: 'pkcs8',
    }),
  )
  return JSON.stringify({
    [kid]: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  })
}

const LOCAL_STACK = {
  AI_KEY_INVENTORY_PROFILE: 'local-stack-v1',
  AI_REQUEST_BINDING_HMAC_KEYS: `request-v1:${'02'.repeat(32)}`,
  AI_SAFETY_IDENTIFIER_HMAC_KEYS: `safety-v1:${'1c'.repeat(32)}`,
  AI_ADMISSION_ED25519_KID: 'admission-v1',
  AI_ADMISSION_ED25519_PRIVATE_KEY_B64: pkcs8Base64(ADMISSION_SEED),
  AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON: publicKeyring('admission-v1', ADMISSION_SEED),
  AI_PROVENANCE_ED25519_KID: 'provenance-v1',
  AI_PROVENANCE_ED25519_PRIVATE_KEY_B64: pkcs8Base64(PROVENANCE_SEED),
} as const

function runtimeWith(overrides: Partial<Record<string, string>>) {
  return createAiEgressRuntime({
    env: { ...LOCAL_STACK, ...overrides } as unknown as Env,
    pool: {} as Pool,
    clock: () => new Date('2026-10-14T10:00:00.000Z'),
    runtimeEnvironment: {},
  })
}

function otherPrivateKeyBase64(): string {
  const { privateKey } = generateKeyPairSync('ed25519')
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
}

describe('AI egress runtime key inventory', () => {
  it('refuses an admission signing key that does not pair with the pinned public key', async () => {
    const runtime = runtimeWith({
      AI_ADMISSION_ED25519_PRIVATE_KEY_B64: otherPrivateKeyBase64(),
    })
    await expect(runtime.service()).rejects.toThrow(
      'AI admission private signing key is invalid',
    )
  })

  it('refuses an admission signing kid the inventory does not hold', async () => {
    const runtime = runtimeWith({ AI_ADMISSION_ED25519_KID: 'admission-v9' })
    await expect(runtime.service()).rejects.toThrow(
      'AI admission active signing kid is invalid',
    )
  })

  it('goes on to the next requirement when the admission key is the pinned one', async () => {
    const runtime = runtimeWith({})
    await expect(runtime.service()).rejects.toThrow('OPENAI_API_KEY is required')
  })
})
