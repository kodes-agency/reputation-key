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
import type { Role } from '#/shared/domain/roles'

export type GoogleConnectionRepository = Readonly<{
  findById: (
    orgId: OrganizationId,
    id: GoogleConnectionId,
  ) => Promise<GoogleConnection | null>
  findByGoogleAccountId: (
    orgId: OrganizationId,
    googleAccountId: string,
  ) => Promise<GoogleConnection | null>
  listByOrganization: (
    orgId: OrganizationId,
    userId: UserId,
    role: Role,
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
