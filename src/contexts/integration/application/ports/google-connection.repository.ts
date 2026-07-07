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

export type GoogleConnectionRepository = Readonly<{
  findById: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
  ) => Promise<GoogleConnection | null>
  findByGoogleAccountId: (
    orgId: OrganizationId,
    googleAccountId: string,
  ) => Promise<GoogleConnection | null>
  // Global lookup (cross-tenant) — used to enforce the one-account-one-org
  // invariant on connect. Deliberately NOT org-scoped.
  findByGoogleAccountIdGlobal: (
    googleAccountId: string,
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
  updateVisibility: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
    visibility: GoogleConnectionVisibility,
  ) => Promise<void>
  updateTokens: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
    encryptedAccessToken: string,
    encryptedRefreshToken: string,
    tokenExpiresAt: Date,
  ) => Promise<void>
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
    encryptedAccessToken: string,
    encryptedRefreshToken: string,
    tokenExpiresAt: Date,
    visibility: GoogleConnectionVisibility,
  ) => Promise<void>
  delete: (orgId: OrganizationId, id: GoogleConnectionId) => Promise<void>
}>
