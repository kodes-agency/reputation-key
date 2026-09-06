import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  createGoogleContentAuthorizationCheck,
  policyAuthorizes,
} from './google-content-authorization-check'

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

// The two capability gates used to disagree, and this one was the odd one out.
// `checkScopedCapability` has always exempted CORE capabilities from the org and
// property allowlists, and nothing in the product ever writes an
// `organization_capability` row for one — so requiring those rows here meant
// property.connect_gbp and property.publish_reply could never authorize for any
// tenant. Review sync and reply publication were dead everywhere, and the
// refusal surfaced three layers away as a bare `provider_failure`.
describe('policyAuthorizes allowlist exemption', () => {
  const capturedFlags = async (capability: Parameters<typeof policyAuthorizes>[1]) => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    await policyAuthorizes(
      { execute } as unknown as Database,
      capability,
      'org-1',
      '00000000-0000-4000-8000-000000000001',
    )
    const query = execute.mock.calls[0]?.[0] as {
      queryChunks?: readonly unknown[]
    }
    // Bound parameters sit between the SQL fragments as bare values.
    return (query.queryChunks ?? []).filter((chunk) => typeof chunk === 'boolean')
  }

  it('exempts a CORE capability from both allowlists', async () => {
    // Both occurrences — organization and property — are bound true.
    expect(await capturedFlags('property.connect_gbp')).toEqual([true, true])
    expect(await capturedFlags('property.publish_reply')).toEqual([true, true])
  })

  it('still requires the allowlists for a cohort capability', async () => {
    // The exemption must not leak: an opt-in capability keeps both EXISTS
    // clauses, which is the whole point of the cohort allowlist.
    expect(await capturedFlags('property.import_gbp_v2')).toEqual([false, false])
    expect(await capturedFlags('property.read_gbp_performance')).toEqual([false, false])
  })
})
