import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { ExecutionDecision } from '#/shared/auth/execution-policy'
import { googleAuthorizationPermissionDigest } from '#/shared/domain/google-content-authorization-vector'
import type { GoogleConnection } from '../domain/types'
import { createGoogleImportCommandAuthorizer } from './google-import-command-authorizer'

const actor: AuthContext = {
  organizationId: organizationId('org-1'),
  userId: userId('user-1'),
  role: 'AccountAdmin',
  effectivePermissions: new Set([
    'integration.manage',
    'property.read',
    'property.update',
  ]),
}
const connectionId = googleConnectionId('11111111-1111-4111-8111-111111111111')
const destinationId = propertyId('22222222-2222-4222-8222-222222222222')
const approvalBindingId = '33333333-3333-4333-8333-333333333333'

const connection = (overrides: Partial<GoogleConnection> = {}): GoogleConnection => ({
  id: connectionId,
  organizationId: actor.organizationId,
  googleSubject: 'subject',
  encryptedAccessToken: 'encrypted-access',
  encryptedRefreshToken: 'encrypted-refresh',
  tokenExpiresAt: new Date('2026-08-12T11:00:00.000Z'),
  scopes: ['https://www.googleapis.com/auth/business.manage'],
  connectedBy: actor.userId,
  visibility: 'organization',
  status: 'active',
  credentialUseState: 'active',
  cleanupMaterialDeadlineAt: null,
  lifecycleVersion: 3,
  accessVersion: 4,
  credentialGeneration: 5,
  encryptionKeyId: 'v1',
  lastSuccessfulSyncAt: null,
  statusReason: null,
  statusChangedAt: null,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  updatedAt: new Date('2026-08-01T10:00:00.000Z'),
  ...overrides,
})

const allow = (policyVersion = 'beta-local-2'): ExecutionDecision => ({
  allowed: true,
  reason: 'allowed',
  action: 'integration.manage',
  policyVersion,
})

const contentAuthorization = (
  overrides: Partial<{
    connectionLifecycleVersion: number
    connectionAccessVersion: number
    credentialGeneration: number
  }> = {},
) => ({
  ok: true as const,
  approvalBindingId,
  policyVersion: 11,
  emergencyKillVersion: 4,
  authorizationVector: {
    executionPolicyVersion: 'beta-local-2',
    googleContentPolicyVersion: 11,
    emergencyKillVersion: 4,
    role: 'AccountAdmin',
    permissionDigest: googleAuthorizationPermissionDigest(actor),
    connectionLifecycleVersion: 3,
    connectionAccessVersion: 4,
    credentialGeneration: 5,
    ...overrides,
  },
})

function setup(
  input?: Readonly<{
    current?: GoogleConnection | null
    decide?: (
      request: Parameters<
        Parameters<typeof createGoogleImportCommandAuthorizer>[0]['decide']
      >[0],
    ) => Promise<ExecutionDecision>
    authorizeGoogleContent?: (
      input: Parameters<
        Parameters<
          typeof createGoogleImportCommandAuthorizer
        >[0]['authorizeGoogleContent']
      >[0],
    ) => Promise<
      Awaited<
        ReturnType<
          Parameters<
            typeof createGoogleImportCommandAuthorizer
          >[0]['authorizeGoogleContent']
        >
      >
    >
  }>,
) {
  const findById = vi.fn(async () => input?.current ?? connection())
  const getAccessToken = vi.fn(async () => 'plain-access-token')
  const decide = vi.fn(input?.decide ?? (async () => allow()))
  const authorizeGoogleContent = vi.fn(
    input?.authorizeGoogleContent ?? (async () => contentAuthorization()),
  )
  const readProperty = vi.fn(async () => ({
    organizationId: actor.organizationId,
    propertyId: destinationId,
    state: 'disconnected' as const,
    connectionId,
    accountId: 'account-1',
    locationId: 'location-1',
    sourceEpoch: 8,
    profileVersion: 6,
    profileSource: 'tenant_confirmed' as const,
    profileConfirmedAt: new Date('2026-08-01T10:00:00.000Z'),
    deletedAt: null,
    name: 'Property',
    address: null,
    countryCode: 'US',
    timezone: 'America/New_York',
    processingRegion: 'us',
    lifecycleState: 'active',
  }))
  const authorize = createGoogleImportCommandAuthorizer({
    connectionRepo: { findById },
    tokenProvider: { getAccessToken },
    decide,
    readProperty,
    authorizeGoogleContent,
  })
  return {
    authorize,
    findById,
    getAccessToken,
    decide,
    readProperty,
    authorizeGoogleContent,
  }
}

describe('authorizeGoogleImportCommand', () => {
  it('returns a connection generation snapshot only after both capability decisions', async () => {
    const { authorize, decide, getAccessToken } = setup()

    const result = await authorize({
      actor,
      connectionId,
      phase: 'provider_call',
      requireAccessToken: true,
    })

    expect(decide).toHaveBeenCalledTimes(2)
    expect(getAccessToken).toHaveBeenCalledWith(actor.organizationId, connectionId)
    expect(result).toMatchObject({
      ok: true,
      authorization: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        connectionId,
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 5,
        approvalBindingId,
        authorizationVector: {
          executionPolicyVersion: 'beta-local-2',
          googleContentPolicyVersion: 11,
          emergencyKillVersion: 4,
          role: 'AccountAdmin',
          connectionLifecycleVersion: 3,
          connectionAccessVersion: 4,
          credentialGeneration: 5,
        },
      },
      accessToken: 'plain-access-token',
    })
  })

  it('reauthorizes a provider call after an authorized credential refresh', async () => {
    const fixture = setup()
    fixture.findById
      .mockResolvedValueOnce(connection())
      .mockResolvedValueOnce(connection({ credentialGeneration: 6 }))
    fixture.authorizeGoogleContent
      .mockResolvedValueOnce(contentAuthorization())
      .mockResolvedValueOnce(contentAuthorization({ credentialGeneration: 6 }))

    await expect(
      fixture.authorize({
        actor,
        connectionId,
        phase: 'provider_call',
        requireAccessToken: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      authorization: {
        connectionLifecycleVersion: 3,
        connectionAccessVersion: 4,
        credentialGeneration: 6,
        authorizationVector: {
          connectionLifecycleVersion: 3,
          connectionAccessVersion: 4,
          credentialGeneration: 6,
        },
      },
      accessToken: 'plain-access-token',
    })
    expect(fixture.authorizeGoogleContent).toHaveBeenCalledTimes(2)
  })

  it('fails closed when connection authority changes during token access', async () => {
    const fixture = setup()
    fixture.findById
      .mockResolvedValueOnce(connection())
      .mockResolvedValueOnce(connection({ lifecycleVersion: 4, credentialGeneration: 6 }))

    await expect(
      fixture.authorize({
        actor,
        connectionId,
        phase: 'provider_call',
        requireAccessToken: true,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    expect(fixture.authorizeGoogleContent).toHaveBeenCalledOnce()
  })

  it('denies before token access for capability, visibility, status, or scope failure', async () => {
    const deniedDecision = setup({
      decide: async () => ({ ...allow(), allowed: false, reason: 'capability_disabled' }),
    })
    await expect(
      deniedDecision.authorize({
        actor,
        connectionId,
        phase: 'provider_call',
        requireAccessToken: true,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(deniedDecision.getAccessToken).not.toHaveBeenCalled()

    for (const current of [
      connection({ visibility: 'private', connectedBy: userId('other-user') }),
      connection({ status: 'disconnected' }),
      connection({ credentialUseState: 'none' }),
      connection({ scopes: [] }),
    ]) {
      const denied = setup({ current })
      await expect(
        denied.authorize({
          actor,
          connectionId,
          phase: 'provider_call',
          requireAccessToken: true,
        }),
      ).resolves.toEqual({ ok: false, code: 'connection_unavailable' })
      expect(denied.getAccessToken).not.toHaveBeenCalled()
    }
  })

  it('denies a post-call check when any frozen connection generation changed', async () => {
    const expected = {
      organizationId: actor.organizationId,
      userId: actor.userId,
      connectionId,
      connectionLifecycleVersion: 3,
      connectionAccessVersion: 4,
      credentialGeneration: 5,
      approvalBindingId,
      authorizationVector: {
        executionPolicyVersion: 'beta-local-2',
        googleContentPolicyVersion: 11,
        emergencyKillVersion: 4,
        role: 'AccountAdmin',
        permissionDigest: 'irrelevant',
      },
    }
    const { authorize, getAccessToken } = setup({
      current: connection({ credentialGeneration: 6 }),
    })

    await expect(
      authorize({
        actor,
        connectionId,
        phase: 'publish',
        expected,
        requireAccessToken: false,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed before token access when content approval is unavailable', async () => {
    const denied = setup({
      authorizeGoogleContent: async () => ({
        ok: false,
        code: 'runtime_unavailable',
      }),
    })
    await expect(
      denied.authorize({
        actor,
        connectionId,
        phase: 'provider_call',
        requireAccessToken: true,
      }),
    ).resolves.toEqual({ ok: false, code: 'runtime_unavailable' })
    expect(denied.getAccessToken).not.toHaveBeenCalled()
  })

  it('rechecks destination generations and scoped permission before publication', async () => {
    const allowed = setup()
    const result = await allowed.authorize({
      actor,
      connectionId,
      phase: 'publish',
      properties: [
        {
          propertyId: destinationId,
          sourceEpoch: 8,
          profileVersion: 6,
          action: 'property.update',
        },
      ],
      requireAccessToken: false,
    })
    expect(result.ok).toBe(true)
    expect(allowed.readProperty).toHaveBeenCalledWith(actor.organizationId, destinationId)
    expect(allowed.decide).toHaveBeenCalledTimes(3)

    const stale = setup()
    stale.readProperty.mockResolvedValueOnce({
      ...(await stale.readProperty()),
      sourceEpoch: 9,
    })
    await expect(
      stale.authorize({
        actor,
        connectionId,
        phase: 'publish',
        properties: [
          {
            propertyId: destinationId,
            sourceEpoch: 8,
            profileVersion: 6,
            action: 'property.update',
          },
        ],
        requireAccessToken: false,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
  })
})
