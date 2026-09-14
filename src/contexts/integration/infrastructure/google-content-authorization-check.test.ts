import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { resetEnv } from '#/shared/config/env'
import { createGoogleContentAuthorizationCheck } from './google-content-authorization-check'
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
const originalCustomRoles = process.env.ENABLE_CUSTOM_ROLES
beforeEach(() => {
  process.env.ENABLE_CUSTOM_ROLES = 'false'
  resetEnv()
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(
    createEnvCapabilityPolicyStore({
      BETA_E2E_GLOBAL_CAPABILITIES: 'property.import_gbp_v2',
    }),
  )
})

afterEach(() => {
  if (originalCustomRoles === undefined) delete process.env.ENABLE_CUSTOM_ROLES
  else process.env.ENABLE_CUSTOM_ROLES = originalCustomRoles
  resetEnv()
  resetCapabilityPolicyStore()
})

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

  // A reply settle reads "no permit" and then commits; a permit admitted in
  // between could start and send before that commit lands, because the start
  // predicate locks neither the attempt nor the reply. Holding the attempt row
  // FOR SHARE until the permit commits makes admission and settlement exclusive
  // (reply-command-store.ts settleNeverDispatchedAttempt re-reads under lock).
  it('share-locks the reply publication attempt it admits a permit for', async () => {
    resetCapabilityPolicyStore()
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({
        BETA_E2E_GLOBAL_CAPABILITIES: 'property.publish_reply',
      }),
    )
    const execute = vi.fn()
    for (const rows of [
      [{ emergency_kill_version: 3 }],
      [{ lifecycle_version: 1, access_version: 1, credential_generation: 1 }],
      [
        {
          source_epoch: 0,
          profile_version: 1,
          google_binding_state: 'active',
          lifecycle_state: 'active',
          profile_source: 'tenant_confirmed',
          profile_confirmed_at: null,
        },
      ],
      [],
    ]) {
      execute.mockResolvedValueOnce({ rows })
    }
    const check = createGoogleContentAuthorizationCheck({
      clock: () => new Date('2026-08-28T00:00:00Z'),
      hasActivePropertyGrant: vi.fn(async () => false),
    })

    await expect(
      check({ execute } as unknown as Database, {
        capability: 'property.publish_reply',
        scope: {
          organizationId: 'org-reply-publication',
          propertyId: '00000000-0000-4000-8000-000000000501',
          connectionId: '00000000-0000-4000-8000-000000000502',
          initiatorUserId: null,
          publication: {
            reviewId: '00000000-0000-4000-8000-000000000503',
            replyId: '00000000-0000-4000-8000-000000000504',
            publicationCycle: 1,
            attemptNumber: 1,
            sourceEpoch: 0,
            materialReviewRevision: 1,
          },
        },
        operationKey: 'provider.reviews.reply',
      }),
    ).resolves.toMatchObject({ allowed: false })

    expect(execute).toHaveBeenCalledTimes(4)
    const publicationQuery = new PgDialect().sqlToQuery(execute.mock.calls[3]![0]).sql
    expect(publicationQuery).toContain("attempt.outcome = 'sending'")
    expect(publicationQuery.trimEnd()).toMatch(/FOR SHARE OF attempt$/u)
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
