import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { createGoogleContentAuthorizationCheck } from './google-content-authorization-check'

const baseInput = {
  capability: 'property.import_gbp_v2' as const,
  scope: {
    organizationId: 'org-oauth-authority',
    propertyId: null,
    connectionId: '00000000-0000-4000-8000-000000000401',
    initiatorUserId: 'user-oauth-authority',
  },
  operationKey: 'oauth.token.exchange',
  vectorMode: 'full' as const,
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
const home = [
  {
    home_cell_id: 'us',
    catalogue_policy_version: DATA_CELL_CATALOGUE_POLICY_VERSION,
    authority_generation: 4,
  },
]

describe('Google OAuth content authorization', () => {
  it('freezes a connectionless first exchange to the current Organization credential home', async () => {
    const { run } = checkWithRows([member, policy, [], home])

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
        credentialHomeCellId: 'us',
        credentialHomePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        credentialHomeAuthorityGeneration: 4,
      },
    })
  })

  it('recomputes the same prospective vector for gateway admission', async () => {
    const { execute } = checkWithRows([member, policy, [], home])

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
        credential_home_cell_id: 'us',
        credential_home_policy_version: DATA_CELL_CATALOGUE_POLICY_VERSION,
        credential_home_authority_generation: 4,
      },
    ]
    const { run } = checkWithRows([member, policy, connection, home])

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

  it.each([
    ['missing home', []],
    [
      'stale home policy',
      [
        {
          ...home[0],
          catalogue_policy_version: DATA_CELL_CATALOGUE_POLICY_VERSION - 1,
        },
      ],
    ],
    ['ambiguous home', [...home, ...home]],
  ] as const)('fails closed for a prospective exchange with %s', async (_name, rows) => {
    const { run } = checkWithRows([member, policy, [], rows])
    await expect(run()).resolves.toEqual({
      allowed: false,
      code: 'authorization_denied',
    })
  })
})
