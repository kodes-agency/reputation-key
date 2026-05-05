// Integration context — google connection repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { GoogleConnection, GoogleConnectionId, GoogleConnectionVisibility, GoogleConnectionStatus } from '../../domain/types'
import type { OrganizationId, UserId } from '#/shared/domain/ids'

export type GoogleConnectionRepository = Readonly<{
  findById: (orgId: OrganizationId, id: GoogleConnectionId) => Promise<GoogleConnection | null>
  findByGoogleAccountId: (orgId: OrganizationId, googleAccountId: string) => Promise<GoogleConnection | null>
  listByOrganization: (orgId: OrganizationId, userId: UserId) => Promise<ReadonlyArray<GoogleConnection>>
  insert: (connection: GoogleConnection) => Promise<void>
  updateStatus: (id: GoogleConnectionId, status: GoogleConnectionStatus) => Promise<void>
  updateVisibility: (id: GoogleConnectionId, visibility: GoogleConnectionVisibility) => Promise<void>
  updateTokens: (id: GoogleConnectionId, encryptedAccessToken: string, encryptedRefreshToken: string, tokenExpiresAt: Date) => Promise<void>
  delete: (id: GoogleConnectionId) => Promise<void>
}>
