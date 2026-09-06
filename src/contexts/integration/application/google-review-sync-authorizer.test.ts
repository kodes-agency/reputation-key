import { describe, expect, it, vi } from 'vitest'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import type { GoogleConnection } from '../domain/types'
import {
  GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL,
  GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
  createGoogleReviewSyncAuthorizer,
} from './google-review-sync-authorizer'

const ORG_ID = organizationId('org-1')
const PROPERTY_ID = propertyId('11111111-1111-4111-8111-111111111111')
const CONNECTION_ID = googleConnectionId('22222222-2222-4222-8222-222222222222')

function binding(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    state: 'active' as const,
    connectionId: CONNECTION_ID,
    locationId: 'provider-location-1',
    sourceEpoch: 7,
    profileVersion: 9,
    profileSource: 'tenant_confirmed' as const,
    profileConfirmedAt: new Date('2026-08-01T00:00:00.000Z'),
    lifecycleState: 'active',
    deletedAt: null,
    ...overrides,
  }
}

function connection(overrides: Partial<GoogleConnection> = {}): GoogleConnection {
  return {
    id: CONNECTION_ID,
    organizationId: ORG_ID,
    googleSubject: 'provider-subject',
    encryptedAccessToken: 'encrypted-access',
    encryptedRefreshToken: 'encrypted-refresh',
    tokenExpiresAt: new Date('2026-08-27T12:00:00.000Z'),
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    // Provenance deliberately points at a non-member and the legacy decoder
    // still reports private. Neither fact participates in authorization.
    connectedBy: userId('former-connector'),
    visibility: 'private',
    status: 'active',
    credentialUseState: 'active',
    cleanupMaterialDeadlineAt: null,
    lifecycleVersion: 3,
    accessVersion: 4,
    credentialGeneration: 5,
    credentialHomeCellId: 'us',
    credentialHomePolicyVersion: 2,
    credentialHomeAuthorityGeneration: 1,
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
    credentialAuthorizedBy:
      overrides.credentialAuthorizedBy ?? userId('current-grant-owner'),
  }
}

function contentVector(overrides: Record<string, string | number | boolean | null> = {}) {
  return {
    executionPolicyVersion: 'beta-local-2',
    principalKind: 'system',
    systemPrincipal: GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL,
    role: 'System',
    permissionVersion: null,
    permissionDigest: sha256Hex(GOOGLE_REVIEW_SYNC_SYSTEM_PRINCIPAL),
    connectionLifecycleVersion: 3,
    connectionAccessVersion: 4,
    credentialGeneration: 5,
    propertySourceEpoch: 7,
    propertyProfileVersion: 9,
    propertyBindingState: 'active',
    propertyLifecycleState: 'active',
    propertyProfileSource: 'tenant_confirmed',
    propertyTimezoneConfirmed: true,
    ...overrides,
  }
}

function setup(
  overrides: Partial<{
    bindings: ReturnType<typeof binding>[]
    connections: GoogleConnection[]
    accessToken: string
    content: Readonly<{
      ok: true
      policyVersion: number
      emergencyKillVersion: number
      authorizationVector: Readonly<Record<string, string | number | boolean | null>>
    }>
    contents: ReadonlyArray<
      Readonly<{
        ok: true
        policyVersion: number
        emergencyKillVersion: number
        authorizationVector: Readonly<Record<string, string | number | boolean | null>>
      }>
    >
  }> = {},
) {
  const bindings = overrides.bindings ?? [binding(), binding()]
  const connections = overrides.connections ?? [connection(), connection()]
  const readBinding = vi.fn(async () => bindings.shift() ?? null)
  const findConnection = vi.fn(async () => connections.shift() ?? null)
  const getAccessToken = vi.fn(async () => overrides.accessToken ?? 'access-token')
  const defaultContent =
    overrides.content ??
    ({
      ok: true as const,
      policyVersion: 11,
      emergencyKillVersion: 2,
      authorizationVector: contentVector(),
    } as const)
  const contents = [...(overrides.contents ?? [defaultContent, defaultContent])]
  const authorizeGoogleContent = vi.fn(async () =>
    Promise.resolve(contents.shift() ?? defaultContent),
  )
  return {
    authorize: createGoogleReviewSyncAuthorizer({
      readBinding,
      findConnection,
      getAccessToken,
      authorizeGoogleContent,
    }),
    readBinding,
    findConnection,
    getAccessToken,
    authorizeGoogleContent,
  }
}

describe('Google review-sync system authorization', () => {
  it('authorizes the Property binding without borrowing connector-user authority', async () => {
    const { authorize, authorizeGoogleContent } = setup()

    await expect(
      authorize({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 7,
      }),
    ).resolves.toEqual({
      ok: true,
      accessToken: 'access-token',
      authorization: {
        capability: 'property.connect_gbp',
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        initiatorUserId: null,
        expectedCredentialGeneration: 5,
        authorizationVector: contentVector(),
      },
    })
    expect(authorizeGoogleContent).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      operationKey: 'review.sync',
    })
  })

  it('freezes a distinct system principal for notification management', async () => {
    const notificationContent = {
      ok: true as const,
      policyVersion: 11,
      emergencyKillVersion: 2,
      authorizationVector: contentVector({
        systemPrincipal: GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL,
        permissionDigest: sha256Hex(GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL),
      }),
    }
    const { authorize, authorizeGoogleContent } = setup({
      content: notificationContent,
    })

    await expect(
      authorize({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 7,
        operationKey: 'notifications.manage',
      }),
    ).resolves.toMatchObject({
      ok: true,
      authorization: {
        capability: 'property.connect_gbp',
        initiatorUserId: null,
        authorizationVector: {
          systemPrincipal: GOOGLE_NOTIFICATION_SYSTEM_PRINCIPAL,
        },
      },
    })
    expect(authorizeGoogleContent).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      operationKey: 'notifications.manage',
    })
  })

  it('rejects the review-sync principal on the notification operation before token access', async () => {
    const { authorize, getAccessToken } = setup()

    await expect(
      authorize({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 7,
        operationKey: 'notifications.manage',
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed before credential access for a stale Property source epoch', async () => {
    const { authorize, getAccessToken, authorizeGoogleContent } = setup({
      bindings: [binding({ sourceEpoch: 8 })],
    })

    await expect(
      authorize({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 7,
      }),
    ).resolves.toEqual({ ok: false, code: 'stale_source' })
    expect(getAccessToken).not.toHaveBeenCalled()
    expect(authorizeGoogleContent).not.toHaveBeenCalled()
  })

  it('uses the post-refresh credential generation in the system permit vector', async () => {
    const refreshed = connection({ credentialGeneration: 6 })
    const { authorize } = setup({
      connections: [connection(), refreshed],
      contents: [
        {
          ok: true,
          policyVersion: 11,
          emergencyKillVersion: 2,
          authorizationVector: contentVector(),
        },
        {
          ok: true,
          policyVersion: 11,
          emergencyKillVersion: 2,
          authorizationVector: contentVector({ credentialGeneration: 6 }),
        },
      ],
    })

    await expect(
      authorize({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 7,
      }),
    ).resolves.toMatchObject({
      ok: true,
      authorization: { expectedCredentialGeneration: 6 },
    })
  })

  it('rejects a human content vector before credential access on the system path', async () => {
    const { authorize, getAccessToken } = setup({
      content: {
        ok: true,
        policyVersion: 11,
        emergencyKillVersion: 2,
        authorizationVector: contentVector({
          principalKind: 'user',
          systemPrincipal: null,
          role: 'AccountAdmin',
          permissionVersion: 4,
        }),
      },
    })

    await expect(
      authorize({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 7,
      }),
    ).resolves.toEqual({ ok: false, code: 'authorization_denied' })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed when the binding changes while a token is refreshed', async () => {
    const { authorize, authorizeGoogleContent } = setup({
      bindings: [binding(), binding({ state: 'disconnected' })],
    })

    await expect(
      authorize({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        sourceEpoch: 7,
      }),
    ).resolves.toEqual({ ok: false, code: 'stale_source' })
    expect(authorizeGoogleContent).toHaveBeenCalledOnce()
  })
})
