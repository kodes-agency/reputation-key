// Integration context — google connection repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type {
  GoogleConnection,
  GoogleConnectionId,
  GoogleConnectionVisibility,
  GoogleConnectionStatus,
} from '../../domain/types'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { GoogleCredentialHomeBinding } from '#/shared/domain/google-credential-home'

/** Tagged error thrown when a unique-constraint violation occurs on insert. */
export type UniqueViolationError = Readonly<{
  _tag: 'UniqueViolationError'
  code: 'unique_violation'
  message: string
}>

export const uniqueViolationError = (message: string): UniqueViolationError => ({
  _tag: 'UniqueViolationError',
  code: 'unique_violation',
  message,
})

export const isUniqueViolationError = (e: unknown): e is UniqueViolationError =>
  typeof e === 'object' &&
  e !== null &&
  (e as UniqueViolationError)._tag === 'UniqueViolationError'

/** Pre-computed visibility filter — the use case decides this, not the repo. */
export type ConnectionVisibilityFilter = Readonly<
  { showAll: true } | { showAll: false; userId: UserId }
>
export type GoogleConnectionIdentityLookup = Readonly<{
  googleSubject: string
}>

export type GoogleConnectionRepository = Readonly<{
  findById: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
  ) => Promise<GoogleConnection | null>
  findByGoogleIdentity: (
    orgId: OrganizationId,
    identity: GoogleConnectionIdentityLookup,
  ) => Promise<GoogleConnection | null>
  // Global lookup enforces the one-provider-identity/one-org invariant.
  findByGoogleIdentityGlobal: (
    identity: GoogleConnectionIdentityLookup,
  ) => Promise<GoogleConnection | null>
  listByOrganization: (
    orgId: OrganizationId,
    filter: ConnectionVisibilityFilter,
  ) => Promise<ReadonlyArray<GoogleConnection>>
  insert: (connection: GoogleConnection) => Promise<void>
  updateStatus: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
    status: GoogleConnectionStatus,
  ) => Promise<void>
  /**
   * Remove provider identifiers and secret material on disconnect. The row
   * remains as a content-free lifecycle fact.
   */
  redactForDisconnect: (orgId: OrganizationId, id: GoogleConnectionId) => Promise<void>
  updateVisibility: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
    visibility: GoogleConnectionVisibility,
  ) => Promise<void>
  updateTokens: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
    expected: Readonly<{
      lifecycleVersion: number
      credentialGeneration: number
    }>,
    encryptedAccessToken: string,
    encryptedRefreshToken: string,
    tokenExpiresAt: Date,
  ) => Promise<boolean>
  updateTokensAndStatus: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
    encryptedAccessToken: string,
    encryptedRefreshToken: string,
    tokenExpiresAt: Date,
    status: GoogleConnectionStatus,
  ) => Promise<void>
  updateReconnection: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
    googleSubject: string,
    encryptedAccessToken: string,
    encryptedRefreshToken: string,
    tokenExpiresAt: Date,
    visibility: GoogleConnectionVisibility,
    scopes: ReadonlyArray<string>,
    credentialHome: GoogleCredentialHomeBinding,
    credentialAuthorizedBy: UserId,
    credentialAuthorizedAt: Date,
  ) => Promise<void>
  delete: (orgId: OrganizationId, id: GoogleConnectionId) => Promise<void>
}>
