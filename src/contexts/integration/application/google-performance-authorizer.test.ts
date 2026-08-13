import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { GoogleConnection } from '../domain/types'
import { createGooglePerformanceAuthorizer } from './google-performance-authorizer'

const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')
const PROPERTY_ID = propertyId('11111111-1111-4111-8111-111111111111')
const CONNECTION_ID = googleConnectionId('22222222-2222-4222-8222-222222222222')
const APPROVAL_ID = '33333333-3333-4333-8333-333333333333'
const actor: AuthContext = Object.freeze({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'PropertyManager',
  effectivePermissions: new Set([
    'property.read',
    'property.update',
    'integration.manage',
  ] as const),
  scopeByPermission: new Map([
    ['property.read', 'organization'],
    ['property.update', 'organization'],
    ['integration.manage', 'organization'],
  ] as const),
})

function connection(overrides: Partial<GoogleConnection> = {}): GoogleConnection {
  const now = new Date('2026-08-12T12:00:00.000Z')
  return {
    id: CONNECTION_ID,
    organizationId: ORG_ID,
    googleSubject: 'provider-subject',
    encryptedAccessToken: 'encrypted-access',
    encryptedRefreshToken: 'encrypted-refresh',
    tokenExpiresAt: new Date('2026-08-12T13:00:00.000Z'),
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    connectedBy: USER_ID,
    visibility: 'organization',
    status: 'active',
    credentialUseState: 'active',
    cleanupMaterialDeadlineAt: null,
    lifecycleVersion: 4,
    accessVersion: 5,
    credentialGeneration: 6,
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    state: 'active' as const,
    connectionId: CONNECTION_ID,
    accountId: 'accounts/123',
    locationId: 'locations/456',
    sourceEpoch: 7,
    profileVersion: 8,
    profileSource: 'tenant_confirmed' as const,
    profileConfirmedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    name: 'Property',
    address: null,
    countryCode: 'US',
    timezone: 'America/New_York',
    processingRegion: 'us',
    lifecycleState: 'active',
    ...overrides,
  }
}

function setup(
  overrides: {
    resolvedActor?: AuthContext | null
    binding?: ReturnType<typeof binding> | null
    connection?: GoogleConnection | null
    decide?: (action: string) => {
      allowed: boolean
      reason: string
      policyVersion: string
    }
    contentAllowed?: boolean
  } = {},
) {
  const readBinding = vi.fn(async () =>
    overrides.binding === undefined ? binding() : overrides.binding,
  )
  const findConnection = vi.fn(async () =>
    overrides.connection === undefined ? connection() : overrides.connection,
  )
  const getAccessToken = vi.fn(async () => 'access-token')
  const decide = vi.fn(
    async (request: { action: string }) =>
      overrides.decide?.(request.action) ?? {
        allowed: true,
        reason: 'allowed',
        policyVersion: 'beta-local-2',
      },
  )
  const authorizeGoogleContent = vi.fn(async () =>
    overrides.contentAllowed === false
      ? { ok: false as const, code: 'authorization_denied' as const }
      : {
          ok: true as const,
          approvalBindingId: APPROVAL_ID,
          policyVersion: 12,
          emergencyKillVersion: 3,
        },
  )
  const authorize = createGooglePerformanceAuthorizer({
    resolveActor: async () =>
      overrides.resolvedActor === undefined ? actor : overrides.resolvedActor,
    readBinding,
    findConnection,
    getAccessToken,
    decide,
    authorizeGoogleContent,
    principalKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
    clock: () => new Date('2026-08-12T12:00:00.000Z'),
  })
  return {
    authorize,
    readBinding,
    findConnection,
    getAccessToken,
    decide,
    authorizeGoogleContent,
  }
}

describe('createGooglePerformanceAuthorizer', () => {
  it('returns a full current snapshot and token for an authorized active binding', async () => {
    const { authorize, getAccessToken } = setup()

    const result = await authorize({
      actor,
      propertyId: PROPERTY_ID,
      phase: 'before_provider',
    })

    expect(result).toMatchObject({
      ok: true,
      accessToken: 'access-token',
      snapshot: {
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        connectionId: CONNECTION_ID,
        locationId: 'locations/456',
        timezone: 'America/New_York',
        sourceEpoch: 7,
        profileVersion: 8,
        connectionLifecycleVersion: 4,
        connectionAccessVersion: 5,
        credentialGeneration: 6,
        approvalBindingId: APPROVAL_ID,
        principalHmacKeyVersion: 'v1',
      },
    })
    if (!result.ok) throw new Error('expected authorization')
    expect(result.snapshot.authorizationVector).toMatchObject({
      executionPolicyVersion: 'beta-local-2',
      googleContentPolicyVersion: 12,
      emergencyKillVersion: 3,
      role: 'PropertyManager',
    })
    expect(result.snapshot.authorizationVectorSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.snapshot.principalHmac).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(getAccessToken).toHaveBeenCalledOnce()
  })

  it('fails closed without reading provider state when current membership disappeared', async () => {
    const { authorize, readBinding, getAccessToken } = setup({ resolvedActor: null })

    await expect(
      authorize({ actor, propertyId: PROPERTY_ID, phase: 'before_provider' }),
    ).resolves.toEqual({
      ok: false,
      result: {
        status: 'unavailable',
        reason: 'integration_unavailable',
        action: null,
      },
    })
    expect(readBinding).not.toHaveBeenCalled()
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('does not disclose a property denied by the current grant', async () => {
    const { authorize, readBinding, getAccessToken } = setup({
      decide: (action) =>
        action === 'property.read'
          ? { allowed: false, reason: 'scope_denied', policyVersion: 'beta-local-2' }
          : { allowed: true, reason: 'allowed', policyVersion: 'beta-local-2' },
    })

    const result = await authorize({
      actor,
      propertyId: PROPERTY_ID,
      phase: 'before_provider',
    })

    expect(result).toEqual({
      ok: false,
      result: {
        status: 'unavailable',
        reason: 'integration_unavailable',
        action: null,
      },
    })
    expect(readBinding).not.toHaveBeenCalled()
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('returns policy_disabled for a killed Performance capability', async () => {
    const { authorize } = setup({
      decide: () => ({
        allowed: false,
        reason: 'capability_disabled',
        policyVersion: 'beta-local-2',
      }),
    })

    await expect(
      authorize({ actor, propertyId: PROPERTY_ID, phase: 'before_provider' }),
    ).resolves.toEqual({
      ok: false,
      result: { status: 'unavailable', reason: 'policy_disabled', action: null },
    })
  })

  it('shows disconnected remediation only to a current integration manager', async () => {
    const { authorize } = setup({ binding: binding({ state: 'disconnected' }) })

    await expect(
      authorize({ actor, propertyId: PROPERTY_ID, phase: 'before_provider' }),
    ).resolves.toEqual({
      ok: false,
      result: {
        status: 'unavailable',
        reason: 'disconnected',
        action: 'open_integrations',
      },
    })
  })

  it('does not disclose a private connection owned by another user', async () => {
    const { authorize, getAccessToken } = setup({
      connection: connection({
        visibility: 'private',
        connectedBy: userId('user-2'),
      }),
    })

    await expect(
      authorize({ actor, propertyId: PROPERTY_ID, phase: 'before_provider' }),
    ).resolves.toEqual({
      ok: false,
      result: {
        status: 'unavailable',
        reason: 'integration_unavailable',
        action: null,
      },
    })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('returns reauthentication remediation for an authorized visible connection', async () => {
    const { authorize, getAccessToken } = setup({
      connection: connection({ status: 'reauth_required' }),
    })

    await expect(
      authorize({ actor, propertyId: PROPERTY_ID, phase: 'before_provider' }),
    ).resolves.toEqual({
      ok: false,
      result: {
        status: 'unavailable',
        reason: 'reauthentication_required',
        action: 'reauthenticate',
      },
    })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('requires tenant-confirmed timezone and gates the edit action independently', async () => {
    const { authorize } = setup({
      binding: binding({ profileConfirmedAt: null, profileSource: 'legacy' }),
      decide: (action) => ({
        allowed: action !== 'property.update',
        reason: action === 'property.update' ? 'permission_denied' : 'allowed',
        policyVersion: 'beta-local-2',
      }),
    })

    await expect(
      authorize({ actor, propertyId: PROPERTY_ID, phase: 'before_provider' }),
    ).resolves.toEqual({
      ok: false,
      result: {
        status: 'unavailable',
        reason: 'timezone_required',
        action: null,
      },
    })
  })

  it('rejects a changed post-provider authorization snapshot as stale', async () => {
    const initialSetup = setup()
    const initial = await initialSetup.authorize({
      actor,
      propertyId: PROPERTY_ID,
      phase: 'before_provider',
    })
    if (!initial.ok) throw new Error('expected initial authorization')
    const changedSetup = setup({ binding: binding({ sourceEpoch: 9 }) })

    await expect(
      changedSetup.authorize({
        actor,
        propertyId: PROPERTY_ID,
        phase: 'before_return',
        expected: initial.snapshot,
      }),
    ).resolves.toEqual({
      ok: false,
      result: {
        status: 'error',
        errorCode: 'stale_source',
        retryable: true,
        retryAfterSeconds: null,
      },
    })
    expect(changedSetup.getAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed when fresh Google Content approval is unavailable', async () => {
    const { authorize, getAccessToken } = setup({ contentAllowed: false })

    await expect(
      authorize({ actor, propertyId: PROPERTY_ID, phase: 'before_provider' }),
    ).resolves.toEqual({
      ok: false,
      result: {
        status: 'unavailable',
        reason: 'policy_disabled',
        action: null,
      },
    })
    expect(getAccessToken).not.toHaveBeenCalled()
  })
})
