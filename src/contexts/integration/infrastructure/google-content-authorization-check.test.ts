import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  createGoogleContentAuthorizationCheck,
} from './google-content-authorization-check'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'

const baseInput = {
  capability: 'property.import_gbp_v2' as const,
  scope: {
    organizationId: 'org-oauth-authority',
    propertyId: null,
    connectionId: '00000000-0000-4000-8000-000000000401',
    initiatorUserId: 'user-oauth-authority',
  },
  operationKey: 'oauth.token.exchange',
}

function checkWithRows(rows: readonly (readonly Record<string, unknown>[])[]) {
  const execute = vi.fn()
  for (const resultRows of rows) {
    execute.mockResolvedValueOnce({ rows: resultRows })
  }
  const check = createGoogleContentAuthorizationCheck({
    clock: () => new Date('2026-08-28T00:00:00Z'),
    hasActivePropertyGrant: vi.fn(async () => false),
  })
  return {
    execute,
    run: () => check({ execute } as unknown as Database, baseInput),
  }
}

const member = [{ role: 'owner', permission_version: 7 }]
const policy = [{ version: 11, emergency_kill_version: 3 }]
beforeEach(() => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(
    createEnvCapabilityPolicyStore({
      BETA_E2E_GLOBAL_CAPABILITIES: 'property.import_gbp_v2',
    }),
  )
})

afterEach(() => resetCapabilityPolicyStore())


describe('Google OAuth content authorization', () => {
  it('authorizes a connectionless first exchange on this deployment', async () => {
    const { run } = checkWithRows([member, policy, []])

    await expect(run()).resolves.toMatchObject({
      allowed: true,
      vector: {
        principalKind: 'user',
        role: 'AccountAdmin',
        permissionVersion: 7,
        oauthCredentialOperation: 'exchange_new',
        connectionLifecycleVersion: 0,
        connectionAccessVersion: 0,
        credentialGeneration: 0,
      },
    })
  })

  it('recomputes the same prospective vector for gateway admission', async () => {
    const { execute } = checkWithRows([member, policy, []])

    await expect(
      createGoogleContentAuthorizationCheck({
        clock: () => new Date('2026-08-28T00:00:00Z'),
        hasActivePropertyGrant: vi.fn(async () => false),
      })({ execute } as unknown as Database, {
        ...baseInput,
        operationKey: 'provider.oauth.token.exchange',
      }),
    ).resolves.toMatchObject({
      allowed: true,
      vector: { oauthCredentialOperation: 'exchange_new' },
    })
  })

  it('allows an exact disconnected target only for credential replacement', async () => {
    const connection = [
      {
        lifecycle_version: 5,
        access_version: 8,
        credential_generation: 13,
        status: 'disconnected',
        credential_use_state: 'none',
      },
    ]
    const { run } = checkWithRows([member, policy, connection])

    await expect(run()).resolves.toMatchObject({
      allowed: true,
      vector: {
        oauthCredentialOperation: 'exchange_existing',
        connectionLifecycleVersion: 5,
        connectionAccessVersion: 8,
        credentialGeneration: 13,
        connectionStatus: 'disconnected',
        credentialUseState: 'none',
      },
    })
  })
})

