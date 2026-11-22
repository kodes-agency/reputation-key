import { vi } from 'vitest'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { ExecutionDecision } from '#/shared/auth/execution-policy'
import { googleAuthorizationPermissionDigest } from '#/shared/domain/google-content-authorization-vector'
import type { GoogleConnection } from '../domain/types'
import { createGoogleImportCommandAuthorizer } from './google-import-command-authorizer.server'

export const actor: AuthContext = {
  organizationId: organizationId('org-1'),
  userId: userId('user-1'),
  role: 'AccountAdmin',
  effectivePermissions: new Set<Permission>([
    'integration.manage',
    'property.read',
    'property.update',
  ]),
}
export const connectionId = googleConnectionId('11111111-1111-4111-8111-111111111111')
export const destinationId = propertyId('22222222-2222-4222-8222-222222222222')

export const connection = (overrides: Partial<GoogleConnection> = {}): GoogleConnection =>
  buildTestGoogleConnection({
    id: connectionId,
    organizationId: actor.organizationId,
    googleSubject: 'subject',
    encryptedAccessToken: 'encrypted-access',
    encryptedRefreshToken: 'encrypted-refresh',
    tokenExpiresAt: new Date('2026-08-12T11:00:00.000Z'),
    connectedBy: actor.userId,
    lifecycleVersion: 3,
    accessVersion: 4,
    credentialGeneration: 5,
    statusChangedAt: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
    credentialAuthorizedBy: overrides.credentialAuthorizedBy ?? actor.userId,
  })

export const allow = (policyVersion = 'beta-local-2'): ExecutionDecision => ({
  allowed: true,
  reason: 'allowed',
  action: 'integration.manage',
  policyVersion,
})

export const contentAuthorization = (
  overrides: Partial<{
    connectionLifecycleVersion: number
    connectionAccessVersion: number
    credentialGeneration: number
  }> = {},
) => ({
  ok: true as const,
  policyVersion: 11,
  emergencyKillVersion: 4,
  authorizationVector: {
    executionPolicyVersion: 'beta-local-2',
    principalKind: 'user',
    role: 'AccountAdmin',
    permissionVersion: 7,
    permissionDigest: googleAuthorizationPermissionDigest(actor),
    connectionLifecycleVersion: 3,
    connectionAccessVersion: 4,
    credentialGeneration: 5,
    ...overrides,
  },
})

/** The relink target as the destination Property was frozen at approval. */
export const RELINK_PROPERTIES = [
  {
    propertyId: destinationId,
    sourceEpoch: 8,
    profileVersion: 6,
    action: 'property.update' as const,
  },
]

export const propertyRead = (
  overrides: Partial<{ sourceEpoch: number; profileVersion: number }> = {},
) => ({
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
  lifecycleState: 'active',
  ...overrides,
})

/** The vector persisted per item at approval time. */
export const frozenAtApproval = (
  overrides: Partial<{ credentialGeneration: number }> = {},
) => {
  const { credentialGeneration = 5 } = overrides
  return {
    organizationId: actor.organizationId,
    userId: actor.userId,
    connectionId,
    connectionLifecycleVersion: 3,
    connectionAccessVersion: 4,
    credentialGeneration,
    authorizationVector: {
      executionPolicyVersion: 'beta-local-2',
      principalKind: 'user',
      role: 'AccountAdmin',
      permissionVersion: 7,
      permissionDigest: googleAuthorizationPermissionDigest(actor),
      connectionLifecycleVersion: 3,
      connectionAccessVersion: 4,
      credentialGeneration,
    },
  }
}

type Deps = Parameters<typeof createGoogleImportCommandAuthorizer>[0]

export function setup(
  input?: Readonly<{
    current?: GoogleConnection | null
    decide?: (request: Parameters<Deps['decide']>[0]) => Promise<ExecutionDecision>
    authorizeGoogleContent?: (
      input: Parameters<Deps['authorizeGoogleContent']>[0],
    ) => Promise<Awaited<ReturnType<Deps['authorizeGoogleContent']>>>
    /**
     * Only the cases that assert on the refusal log pass this; every other
     * case leaves it unset, which is what proves the dep is optional and
     * defaults to a no-op.
     */
    warn?: (fields: Readonly<Record<string, unknown>>, message: string) => void
  }>,
) {
  const findById = vi.fn(async () => input?.current ?? connection())
  const getAccessToken = vi.fn(async () => 'plain-access-token')
  const decide = vi.fn(input?.decide ?? (async () => allow()))
  const authorizeGoogleContent = vi.fn(
    input?.authorizeGoogleContent ?? (async () => contentAuthorization()),
  )
  const readProperty = vi.fn(async () => propertyRead())
  const authorize = createGoogleImportCommandAuthorizer({
    connectionRepo: { findById },
    tokenProvider: { getAccessToken },
    decide,
    readProperty,
    authorizeGoogleContent,
    clock: () => new Date('2026-08-12T12:00:00.000Z'),
    ...(input?.warn ? { warn: input.warn } : {}),
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

type Fixture = Pick<ReturnType<typeof setup>, 'authorize'>
type AuthorizeInput = Parameters<Fixture['authorize']>[0]
type CallOverrides = Partial<Omit<AuthorizeInput, 'phase'>>

/** A `provider_call` authorization that asks for the access token. */
export const providerCall = (fixture: Fixture, overrides: CallOverrides = {}) =>
  fixture.authorize({
    actor,
    connectionId,
    phase: 'provider_call',
    requireAccessToken: true,
    ...overrides,
  } as AuthorizeInput)

/** A `publish` recheck, which never asks for the access token. */
export const publish = (fixture: Fixture, overrides: CallOverrides = {}) =>
  fixture.authorize({
    actor,
    connectionId,
    phase: 'publish',
    requireAccessToken: false,
    ...overrides,
  } as AuthorizeInput)
