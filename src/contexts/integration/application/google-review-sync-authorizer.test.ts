import { describe, expect, it, vi } from 'vitest'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import { integrationError, reauthorizationRequiredError } from '../domain/errors'
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
    googleAccountEmail: null,
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
    getAccessToken: () => Promise<string>
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
  const getAccessToken = vi.fn(
    overrides.getAccessToken ?? (async () => overrides.accessToken ?? 'access-token'),
  )
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
  const warn = vi.fn()
  return {
    authorize: createGoogleReviewSyncAuthorizer({
      readBinding,
      findConnection,
      getAccessToken,
      authorizeGoogleContent,
      warn,
    }),
    readBinding,
    findConnection,
    getAccessToken,
    authorizeGoogleContent,
    warn,
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

const REQUEST = {
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  sourceEpoch: 7,
} as const

describe('Google review-sync authorization when the connection cannot be used', () => {
  // A connection that waits for a reconnect is not a fault in the call: the
  // reconnect notice is the signal, so the caller must be able to tell it from
  // a connection that is usable but refused (the cases below the table).
  it.each([
    ['status reauth_required', { status: 'reauth_required' as const }],
    ['status disconnected', { status: 'disconnected' as const }],
    ['status disconnecting', { status: 'disconnecting' as const }],
    ['status degraded', { status: 'degraded' as const }],
    [
      'credential use state cleanup_only',
      { credentialUseState: 'cleanup_only' as const },
    ],
    ['credential use state none', { credentialUseState: 'none' as const }],
    ['no business.manage scope', { scopes: ['openid', 'email'] }],
  ])(
    'says connection_unusable for a connection with %s, before any token or content access',
    async (_label, overrides) => {
      const { authorize, getAccessToken, authorizeGoogleContent, warn } = setup({
        connections: [connection(overrides)],
      })

      await expect(authorize(REQUEST)).resolves.toEqual({
        ok: false,
        code: 'connection_unusable',
      })
      expect(getAccessToken).not.toHaveBeenCalled()
      expect(authorizeGoogleContent).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    },
  )

  it('says connection_unusable when the connection breaks while the token is refreshed', async () => {
    const { authorize, authorizeGoogleContent } = setup({
      connections: [connection(), connection({ status: 'reauth_required' })],
    })

    await expect(authorize(REQUEST)).resolves.toEqual({
      ok: false,
      code: 'connection_unusable',
    })
    expect(authorizeGoogleContent).toHaveBeenCalledOnce()
  })

  it('says connection_unusable when the refresh itself learns Google refused the grant', async () => {
    const { authorize, authorizeGoogleContent } = setup({
      getAccessToken: async () => {
        throw reauthorizationRequiredError()
      },
    })

    await expect(authorize(REQUEST)).resolves.toEqual({
      ok: false,
      code: 'connection_unusable',
    })
    expect(authorizeGoogleContent).toHaveBeenCalledOnce()
  })

  it.each([
    ['a transport failure', () => new Error('socket hang up')],
    [
      'a refresh that lost its credential fence',
      () => integrationError('connection_disconnected', 'Credential authority changed'),
    ],
    [
      'a refresh Google could not answer',
      () => integrationError('token_refresh_failed', 'x'),
    ],
  ])(
    'stays runtime_unavailable (retried) for %s from the token provider',
    async (_label, makeError) => {
      const { authorize } = setup({
        getAccessToken: async () => {
          throw makeError()
        },
      })

      await expect(authorize(REQUEST)).resolves.toEqual({
        ok: false,
        code: 'runtime_unavailable',
      })
    },
  )
})

describe('Google review-sync authorization refused while the connection is usable', () => {
  it('stays authorization_denied, with a warning, when the permit vector changed during the refresh', async () => {
    const { authorize, warn, getAccessToken } = setup({
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
          authorizationVector: contentVector({ propertyProfileVersion: 10 }),
        },
      ],
    })

    await expect(authorize(REQUEST)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
    expect(getAccessToken).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'google_review_sync_authorization_vector_changed',
      }),
      'Google review sync authorization changed',
    )
  })

  it('stays authorization_denied when the content posture denies the call', async () => {
    const denied = createGoogleReviewSyncAuthorizer({
      readBinding: vi.fn(async () => binding()),
      findConnection: vi.fn(async () => connection()),
      getAccessToken: vi.fn(async () => 'access-token'),
      authorizeGoogleContent: vi.fn(async () => ({
        ok: false as const,
        code: 'authorization_denied' as const,
      })),
    })

    await expect(denied(REQUEST)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
  })

  it('stays authorization_denied for a connection the lookup does not find', async () => {
    const { authorize, getAccessToken } = setup({ connections: [] })

    await expect(authorize(REQUEST)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('stays authorization_denied for a connection of another organization', async () => {
    const { authorize } = setup({
      connections: [connection({ organizationId: organizationId('org-2') })],
    })

    await expect(authorize(REQUEST)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
  })
})
