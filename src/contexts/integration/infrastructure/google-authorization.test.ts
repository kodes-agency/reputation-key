import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import {
  FROZEN_VECTOR_EXCLUDED_KEYS,
  googleAuthorizationPermissionDigest,
  type GoogleContentAuthorizationCheck,
  type GoogleContentAuthorizationVector,
} from '#/shared/domain/google-content-authorization-vector'
import type { GoogleContentCapability } from '#/shared/domain/google-content-capability'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { sha256Hex } from '#/shared/domain/sha256'
import { createGoogleImportCommandAuthorizer } from '../application/google-import-command-authorizer'
import { createGooglePerformanceAuthorizer } from '../application/google-performance-authorizer'
import { createGoogleReviewSyncAuthorizer } from '../application/google-review-sync-authorizer'
import { createGoogleReplyPublicationAuthorizer } from '../application/google-reply-publication-authorizer'
import type { GoogleConnection } from '../domain/types'
import { createGoogleContentAuthorizationCheck } from './google-content-authorization-check'
import { createGoogleContentAuthorizer } from './google-content-authorizer'

const ORG = organizationId('org-vector')
const USER = userId('user-vector')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const CONNECTION = googleConnectionId('22222222-2222-4222-8222-222222222222')
const now = new Date('2026-08-28T00:00:00Z')
const publication = {
  reviewId: '33333333-3333-4333-8333-333333333333',
  replyId: '44444444-4444-4444-8444-444444444444',
  publicationCycle: 1,
  attemptNumber: 2,
  sourceEpoch: 4,
  materialReviewRevision: 6,
}
const surfaces = [
  'import',
  'performance',
  'review-sync',
  'notifications',
  'reply-publication',
] as const
type Surface = (typeof surfaces)[number]

beforeEach(() => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: '*' }))
})
afterEach(resetCapabilityPolicyStore)

async function setup(surface: Surface) {
  const state = {
    connection: {
      id: CONNECTION,
      organizationId: ORG,
      googleSubject: 'subject',
      googleAccountEmail: null,
      encryptedAccessToken: 'encrypted',
      encryptedRefreshToken: 'encrypted',
      tokenExpiresAt: now,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      connectedBy: USER,
      credentialAuthorizedBy: USER,
      visibility: 'organization',
      status: 'active',
      credentialUseState: 'active',
      cleanupMaterialDeadlineAt: null,
      lifecycleVersion: 1,
      accessVersion: 2,
      credentialGeneration: 3,
      encryptionKeyId: 'local',
      lastSuccessfulSyncAt: null,
      statusReason: null,
      statusChangedAt: null,
      createdAt: now,
      updatedAt: now,
    } satisfies GoogleConnection,
    killedCapabilities: [] as GoogleContentCapability[],
    omitDigest: false,
  }
  const binding = {
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    locationId: 'locations/123',
    state: 'active',
    lifecycleState: 'active',
    deletedAt: null,
    sourceEpoch: 4,
    profileVersion: 5,
    profileSource: 'tenant_confirmed' as const,
    profileConfirmedAt: now,
    timezone: 'Europe/Sofia',
  }
  // SQL transport is fake; principal resolution, policy and vector emission are real.
  const execute = vi.fn(async (query: SQL) => {
    const text = new PgDialect().sqlToQuery(query).sql
    if (text.includes('FROM member'))
      return { rows: [{ role: 'owner', permission_version: 7 }] }
    if (text.includes('FROM capability_execution_control'))
      return { rows: [{ emergency_kill_version: 1 }] }
    if (text.includes('FROM google_connections'))
      return {
        rows: [
          {
            lifecycle_version: state.connection.lifecycleVersion,
            access_version: state.connection.accessVersion,
            credential_generation: state.connection.credentialGeneration,
          },
        ],
      }
    if (text.includes('FROM properties'))
      return {
        rows: [
          {
            source_epoch: binding.sourceEpoch,
            profile_version: binding.profileVersion,
            google_binding_state: binding.state,
            lifecycle_state: binding.lifecycleState,
            profile_source: binding.profileSource,
            profile_confirmed_at: binding.profileConfirmedAt,
          },
        ],
      }
    if (text.includes('FROM reply_publication_attempts'))
      return {
        rows: [
          {
            reply_state_revision: 8,
            base_observation_revision: 9,
            expected_reply_digest: 'a'.repeat(64),
            authorized_by_user_id: USER,
            confirming_member_role: 'owner',
            confirming_permission_version: 7,
          },
        ],
      }
    throw new Error('Unexpected authorization query')
  })
  const tx = {
    execute,
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ version: 7 }] }) }),
    }),
  } as unknown as Database
  const actor = (
    await resolveMemberAuthContextWithDatabase(tx, {
      memberRole: 'owner',
      organizationId: ORG,
      userId: USER,
    })
  ).context
  const emitted: GoogleContentAuthorizationVector[] = []
  const check = createGoogleContentAuthorizationCheck({
    clock: () => now,
    hasActivePropertyGrant: async () => true,
  })
  const authorize: GoogleContentAuthorizationCheck<Database> = async (db, input) => {
    const result = await check(db, input)
    if (!result.allowed) return result
    emitted.push(result.vector)
    if (!state.omitDigest) return result
    const vector = { ...result.vector }
    delete vector.permissionDigest
    return { ...result, vector }
  }
  const warn = vi.fn()
  const authorizeContent = createGoogleContentAuthorizer({
    store: {
      transaction: async (run) => run(tx),
      loadControl: async () => ({ killedCapabilities: state.killedCapabilities }),
    },
    authorize,
    warn,
  })
  const getAccessToken = vi.fn(async () => {
    state.connection = { ...state.connection, credentialGeneration: 4 }
    return 'refreshed-token'
  })
  const readBinding = async () => binding
  const findConnection = async () => state.connection
  const decide = async () => ({
    allowed: true,
    reason: 'allowed',
    policyVersion: 'beta-local-2',
  })
  const base = {
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    sourceEpoch: 4,
  }
  let run: () => Promise<{ ok: boolean; vector?: GoogleContentAuthorizationVector }>
  if (surface === 'import') {
    const authorizer = createGoogleImportCommandAuthorizer({
      connectionRepo: { findById: findConnection },
      tokenProvider: { getAccessToken },
      decide,
      readProperty: readBinding,
      clock: () => now,
      authorizeGoogleContent: (input) =>
        authorizeContent('import', {
          capability: 'property.import_gbp_v2',
          operationKey: `import.${input.phase}`,
          scope: {
            organizationId: ORG,
            propertyId: null,
            connectionId: input.connectionId,
            initiatorUserId: USER,
          },
        }),
    })
    run = async () => {
      const result = await authorizer({
        actor,
        connectionId: CONNECTION,
        phase: 'provider_call',
        requireAccessToken: true,
        properties: [
          {
            propertyId: PROPERTY,
            sourceEpoch: 4,
            profileVersion: 5,
            action: 'property.update',
          },
        ],
      })
      return {
        ok: result.ok,
        vector: result.ok ? result.authorization.authorizationVector : undefined,
      }
    }
  } else if (surface === 'performance') {
    const authorizer = createGooglePerformanceAuthorizer({
      resolveActor: async () => actor,
      readBinding,
      findConnection,
      getAccessToken,
      decide,
      clock: () => now,
      principalKeys: createVersionedHmacKeyring(`local:${'11'.repeat(32)}`),
      authorizeGoogleContent: (input) =>
        authorizeContent('performance', {
          capability: 'property.read_gbp_performance',
          operationKey: `performance.${input.phase}`,
          scope: { ...base, initiatorUserId: USER },
        }),
    })
    run = async () => {
      const result = await authorizer({
        actor,
        propertyId: PROPERTY,
        phase: 'before_provider',
      })
      return {
        ok: result.ok,
        vector: result.ok ? result.snapshot.authorizationVector : undefined,
      }
    }
  } else if (surface === 'reply-publication') {
    const authorizer = createGoogleReplyPublicationAuthorizer({
      readBinding,
      findConnection,
      getAccessToken,
      authorizeGoogleContent: () =>
        authorizeContent('reply-publication', {
          capability: 'property.publish_reply',
          operationKey: 'reply.publish',
          scope: { ...base, initiatorUserId: null, publication },
        }),
    })
    run = async () => {
      const result = await authorizer({ ...base, ...publication })
      return {
        ok: result.ok,
        vector: result.ok ? result.authorization.authorizationVector : undefined,
      }
    }
  } else {
    const operationKey =
      surface === 'notifications' ? 'notifications.manage' : 'review.sync'
    const authorizer = createGoogleReviewSyncAuthorizer({
      readBinding,
      findConnection,
      getAccessToken,
      authorizeGoogleContent: () =>
        authorizeContent('review-sync', {
          capability: 'property.connect_gbp',
          operationKey,
          scope: { ...base, initiatorUserId: null },
        }),
    })
    run = async () => {
      const result = await authorizer({ ...base, operationKey })
      return {
        ok: result.ok,
        vector: result.ok ? result.authorization.authorizationVector : undefined,
      }
    }
  }
  return { run, state, binding, actor, emitted, getAccessToken, warn }
}

describe.each(surfaces)('%s emitted Google authorization', (surface) => {
  it('accepts the resolver vector after refresh without adding or dropping keys', async () => {
    const fixture = await setup(surface)
    const result = await fixture.run()
    expect(result.ok).toBe(true)
    expect(fixture.emitted).toHaveLength(2)
    expect(result.vector).toEqual(fixture.emitted[1])
    const systemPrincipal =
      surface === 'notifications'
        ? 'notification-management-worker-v1'
        : surface === 'reply-publication'
          ? 'reply-publication-worker-v1'
          : 'review-sync-worker-v1'
    const principal =
      surface === 'import' || surface === 'performance'
        ? {
            principalKind: 'user',
            role: 'AccountAdmin',
            permissionVersion: 7,
            permissionDigest: googleAuthorizationPermissionDigest(fixture.actor),
          }
        : {
            principalKind: 'system',
            role: 'System',
            permissionVersion: null,
            systemPrincipal,
            permissionDigest: sha256Hex(systemPrincipal),
          }
    expect(result.vector).toEqual({
      executionPolicyVersion: 'beta-local-2',
      ...principal,
      connectionLifecycleVersion: 1,
      connectionAccessVersion: 2,
      credentialGeneration: 4,
      ...(surface === 'import'
        ? {}
        : {
            propertySourceEpoch: 4,
            propertyProfileVersion: 5,
            propertyBindingState: 'active',
            propertyLifecycleState: 'active',
            propertyProfileSource: 'tenant_confirmed',
            propertyTimezoneConfirmed: true,
          }),
      ...(surface === 'reply-publication'
        ? {
            confirmingActorUserId: USER,
            confirmingActorRole: 'AccountAdmin',
            confirmingActorPermissionVersion: 7,
            reviewId: publication.reviewId,
            replyId: publication.replyId,
            publicationCycle: 1,
            publicationAttemptNumber: 2,
            materialReviewRevision: 6,
            replyStateRevision: 8,
            baseObservationRevision: 9,
            expectedReplyDigest: 'a'.repeat(64),
          }
        : {}),
    })
    for (const key of FROZEN_VECTOR_EXCLUDED_KEYS)
      expect(result.vector).toHaveProperty(key)
  })

  it('refuses a foreign connection before credential access', async () => {
    const fixture = await setup(surface)
    fixture.state.connection.organizationId = organizationId('other-org')
    expect((await fixture.run()).ok).toBe(false)
    expect(fixture.getAccessToken).not.toHaveBeenCalled()
  })

  it('refuses a foreign connection after credential access', async () => {
    const fixture = await setup(surface)
    fixture.getAccessToken.mockImplementation(async () => {
      fixture.state.connection.organizationId = organizationId('other-org')
      return 'refreshed-token'
    })
    expect((await fixture.run()).ok).toBe(false)
    expect(fixture.getAccessToken).toHaveBeenCalledOnce()
  })

  it.each(['before', 'during'] as const)(
    'refuses a foreign Property %s credential access',
    async (when) => {
      const fixture = await setup(surface)
      const makeForeign = () => {
        fixture.binding.organizationId = organizationId('other-org')
      }
      if (when === 'before') makeForeign()
      else
        fixture.getAccessToken.mockImplementation(async () => {
          makeForeign()
          return 'refreshed-token'
        })
      expect((await fixture.run()).ok).toBe(false)
      expect(fixture.getAccessToken).toHaveBeenCalledTimes(when === 'before' ? 0 : 1)
    },
  )

  it('refuses an emitted vector missing its permission digest', async () => {
    const fixture = await setup(surface)
    fixture.state.omitDigest = true
    expect((await fixture.run()).ok).toBe(false)
    expect(fixture.getAccessToken).not.toHaveBeenCalled()
  })

  it('keeps the live capability kill ahead of credential access', async () => {
    const fixture = await setup(surface)
    fixture.state.killedCapabilities = [
      'property.import_gbp_v2',
      'property.read_gbp_performance',
      'property.connect_gbp',
      'property.publish_reply',
    ]
    expect((await fixture.run()).ok).toBe(false)
    expect(fixture.getAccessToken).not.toHaveBeenCalled()
    expect(fixture.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'capability_killed' }),
      expect.any(String),
    )
  })

  it('refuses a live capability kill applied during token access', async () => {
    const fixture = await setup(surface)
    fixture.getAccessToken.mockImplementation(async () => {
      fixture.state.killedCapabilities = [
        'property.import_gbp_v2',
        'property.read_gbp_performance',
        'property.connect_gbp',
        'property.publish_reply',
      ]
      return 'refreshed-token'
    })
    expect((await fixture.run()).ok).toBe(false)
    expect(fixture.getAccessToken).toHaveBeenCalledOnce()
  })
})
