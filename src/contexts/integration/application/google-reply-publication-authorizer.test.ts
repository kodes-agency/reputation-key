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
  GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL,
  createGoogleReplyPublicationAuthorizer,
  type GoogleReplyPublicationContentAuthorizationResult,
} from './google-reply-publication-authorizer'

const ORG_ID = organizationId('org-1')
const PROPERTY_ID = propertyId('11111111-1111-4111-8111-111111111111')
const CONNECTION_ID = googleConnectionId('22222222-2222-4222-8222-222222222222')
const REVIEW_ID = '33333333-3333-4333-8333-333333333333'
const REPLY_ID = '44444444-4444-4444-8444-444444444444'
const APPROVAL_ID = '55555555-5555-4555-8555-555555555555'

const request = {
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  connectionId: CONNECTION_ID,
  sourceEpoch: 7,
  reviewId: REVIEW_ID,
  materialReviewRevision: 9,
  replyId: REPLY_ID,
  publicationCycle: 3,
  attemptNumber: 2,
} as const

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
    connectedBy: userId('departed-connector'),
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
    systemPrincipal: GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL,
    role: 'System',
    permissionVersion: null,
    permissionDigest: sha256Hex(GOOGLE_REPLY_PUBLICATION_SYSTEM_PRINCIPAL),
    confirmingActorUserId: 'manager-1',
    confirmingActorRole: 'PropertyManager',
    confirmingActorPermissionVersion: 14,
    connectionLifecycleVersion: 3,
    connectionAccessVersion: 4,
    credentialGeneration: 5,
    propertySourceEpoch: 7,
    propertyProfileVersion: 9,
    propertyBindingState: 'active',
    propertyLifecycleState: 'active',
    propertyProfileSource: 'tenant_confirmed',
    propertyTimezoneConfirmed: true,
    reviewId: REVIEW_ID,
    replyId: REPLY_ID,
    publicationCycle: 3,
    publicationAttemptNumber: 2,
    materialReviewRevision: 9,
    replyStateRevision: 12,
    baseObservationRevision: 4,
    expectedReplyDigest: 'a'.repeat(64),
    ...overrides,
  }
}

function content(vector = contentVector()) {
  return {
    ok: true as const,
    approvalBindingId: APPROVAL_ID,
    policyVersion: 11,
    emergencyKillVersion: 2,
    authorizationVector: vector,
  }
}

function setup(
  overrides: Partial<{
    bindings: ReturnType<typeof binding>[]
    connections: GoogleConnection[]
    contents: GoogleReplyPublicationContentAuthorizationResult[]
  }> = {},
) {
  const bindings = overrides.bindings ?? [binding(), binding()]
  const connections = overrides.connections ?? [connection(), connection()]
  const contents = overrides.contents ?? [content(), content()]
  const readBinding = vi.fn(async () => bindings.shift() ?? null)
  const findConnection = vi.fn(async () => connections.shift() ?? null)
  const getAccessToken = vi.fn(async () => 'access-token')
  const authorizeGoogleContent = vi.fn(
    async (): Promise<GoogleReplyPublicationContentAuthorizationResult> =>
      contents.shift() ?? { ok: false, code: 'runtime_unavailable' },
  )
  return {
    authorize: createGoogleReplyPublicationAuthorizer({
      readBinding,
      findConnection,
      getAccessToken,
      authorizeGoogleContent,
    }),
    getAccessToken,
    authorizeGoogleContent,
  }
}

describe('Google reply-publication system authorization', () => {
  it('binds the durable attempt without borrowing connector provenance', async () => {
    const { authorize, authorizeGoogleContent } = setup()

    await expect(authorize(request)).resolves.toMatchObject({
      ok: true,
      accessToken: 'access-token',
      authorization: {
        capability: 'property.publish_reply',
        initiatorUserId: null,
        expectedCredentialGeneration: 5,
        publication: {
          reviewId: REVIEW_ID,
          replyId: REPLY_ID,
          publicationCycle: 3,
          attemptNumber: 2,
          sourceEpoch: 7,
          materialReviewRevision: 9,
        },
      },
    })
    expect(authorizeGoogleContent).toHaveBeenCalledWith({
      ...request,
      operationKey: 'reply.publish',
    })
  })

  it('fails before credential access when the durable material revision is stale', async () => {
    const { authorize, getAccessToken } = setup({
      contents: [{ ok: false, code: 'authorization_denied' }],
    })
    await expect(authorize(request)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('freezes the credential generation produced by refresh', async () => {
    const { authorize } = setup({
      connections: [connection(), connection({ credentialGeneration: 6 })],
      contents: [content(), content(contentVector({ credentialGeneration: 6 }))],
    })
    await expect(authorize(request)).resolves.toMatchObject({
      ok: true,
      authorization: { expectedCredentialGeneration: 6 },
    })
  })

  it.each([
    ['stale publication cycle', { publicationCycle: 2 }],
    ['stale material review revision', { materialReviewRevision: 8 }],
    ['non-current attempt', { publicationAttemptNumber: 1 }],
    ['malformed reply digest', { expectedReplyDigest: 'not-a-digest' }],
    ['wrong credential generation', { credentialGeneration: 4 }],
  ] as const)('rejects a %s vector before credential access', async (_label, drift) => {
    const { authorize, getAccessToken } = setup({
      contents: [content(contentVector(drift))],
    })
    await expect(authorize(request)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('denies when the confirming manager loses authority during token refresh', async () => {
    const { authorize, getAccessToken } = setup({
      contents: [content(), { ok: false, code: 'authorization_denied' }],
    })
    await expect(authorize(request)).resolves.toEqual({
      ok: false,
      code: 'authorization_denied',
    })
    expect(getAccessToken).toHaveBeenCalledOnce()
  })
})
