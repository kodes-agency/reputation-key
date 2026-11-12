import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '#/shared/config/env'
import type { AiAdmissionDescriptorV1 } from '#/shared/ai-internal-transport-contract'
import type { AiExecutionAdmissionAuthority } from '#/shared/ai-provider-control/execution-admission'
import {
  admitForTest,
  descriptorForTest,
} from '#/shared/ai-provider-control/execution-admission.test-fixtures'
import { createAiEgressRuntime, inProcessAdmissionClient } from './ai-egress-runtime'

// The local-stack signing inventory (`AI_GATEWAY_LOCAL_STACK_KEY_INVENTORY_V1`)
// pins the RFC 8032 test keys, the same ones `e2e/stack.env` carries.
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
  it('refuses a provenance signing key that does not pair with the pinned public key', async () => {
    const runtime = runtimeWith({
      AI_PROVENANCE_ED25519_PRIVATE_KEY_B64: otherPrivateKeyBase64(),
    })
    await expect(runtime.service()).rejects.toThrow(
      'AI provenance private signing key is invalid',
    )
  })

  it('no longer reads the admission signing or request-binding keys', async () => {
    const runtime = runtimeWith({
      AI_REQUEST_BINDING_HMAC_KEYS: undefined,
      AI_ADMISSION_ED25519_KID: 'admission-v9',
      AI_ADMISSION_ED25519_PRIVATE_KEY_B64: otherPrivateKeyBase64(),
      AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON: undefined,
    })
    await expect(runtime.service()).rejects.toThrow('OPENAI_API_KEY is required')
  })

  it('goes on to the next requirement when the provenance key is the pinned one', async () => {
    const runtime = runtimeWith({})
    await expect(runtime.service()).rejects.toThrow('OPENAI_API_KEY is required')
  })
})

describe('the in-process admission client', () => {
  const descriptor = descriptorForTest()
  const malformed = { ...descriptor, extra: true } as unknown as AiAdmissionDescriptorV1
  const outcome = {
    disposition: 'no_dispatch',
    reportedDisposition: 'no_dispatch',
    providerRetryable: false,
    usageKnown: false,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    retryAfterSeconds: null,
  } as const
  const signal = new AbortController().signal

  function authority(
    overrides: Partial<AiExecutionAdmissionAuthority> = {},
  ): AiExecutionAdmissionAuthority {
    return {
      authorize: vi.fn(async () => ({
        status: 'denied' as const,
        code: 'subject_mismatch' as const,
      })),
      settle: vi.fn(async () => ({
        status: 'denied' as const,
        code: 'permit_mismatch' as const,
      })),
      readiness: async () => true,
      ...overrides,
    }
  }

  it('turns a database failure into one opaque error, never an admission', async () => {
    const failing = authority({
      authorize: async () => {
        throw new Error('connection to 10.0.0.5 refused')
      },
      settle: async () => {
        throw new Error('lock timeout on ai_operations')
      },
    })
    const client = inProcessAdmissionClient(failing)
    await expect(client.authorize(descriptor, signal)).rejects.toThrow(
      new Error('AI admission authority is unavailable'),
    )
    await expect(
      client.settle(admitForTest(descriptor), outcome, signal),
    ).rejects.toThrow(new Error('AI admission authority is unavailable'))
  })

  it('refuses a descriptor that is not the strict contract before the database', async () => {
    const authorize = vi.fn<AiExecutionAdmissionAuthority['authorize']>()
    const client = inProcessAdmissionClient(authority({ authorize }))
    await expect(client.authorize(malformed, signal)).resolves.toEqual({
      status: 'denied',
      code: 'malformed_request',
    })
    expect(authorize).not.toHaveBeenCalled()
  })

  it('settles only an admission the authority minted, by its permit and attempt', async () => {
    const settle = vi.fn<AiExecutionAdmissionAuthority['settle']>(async () => ({
      status: 'denied',
      code: 'settlement_conflict',
    }))
    const client = inProcessAdmissionClient(authority({ settle }))
    const admission = admitForTest(descriptor)

    await expect(client.settle({ ...admission }, outcome, signal)).resolves.toEqual({
      status: 'denied',
      code: 'permit_mismatch',
    })
    expect(settle).not.toHaveBeenCalled()

    await client.settle(admission, outcome, signal)
    expect(settle).toHaveBeenCalledWith(
      {
        operationId: descriptor.operationId,
        permitId: descriptor.permitId,
        attemptNumber: descriptor.attemptNumber,
      },
      outcome,
    )
  })
})
