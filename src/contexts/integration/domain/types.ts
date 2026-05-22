// Integration context — domain types
// Per architecture: types are data only — no methods, no classes.
// readonly on every field. Branded IDs prevent accidental substitution.

import type {
  OrganizationId,
  UserId,
  GoogleConnectionId,
  GbpImportJobId,
  GbpCacheEntryId,
  PropertyId,
} from '#/shared/domain/ids'

export type GoogleConnectionVisibility = 'private' | 'organization'

export type GoogleConnectionStatus = 'active' | 'disconnected'

export type GoogleConnection = Readonly<{
  id: GoogleConnectionId
  organizationId: OrganizationId
  googleAccountId: string
  googleEmail: string
  encryptedAccessToken: string
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  scopes: ReadonlyArray<string>
  connectedBy: UserId
  visibility: GoogleConnectionVisibility
  status: GoogleConnectionStatus
  createdAt: Date
  updatedAt: Date
}>

export type GbpCacheDataType = 'location'

export type GbpCacheEntry = Readonly<{
  id: GbpCacheEntryId
  organizationId: OrganizationId
  propertyId: PropertyId
  gbpPlaceId: string
  dataType: GbpCacheDataType
  payload: unknown
  googleAttribution: string | null
  fetchedAt: Date
  expiresAt: Date
  updatedAt: Date
}>

export type GbpImportJobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'completed_with_skips'
  | 'completed_with_failures'

export type GbpImportJob = Readonly<{
  id: GbpImportJobId
  organizationId: OrganizationId
  initiatedBy: UserId
  status: GbpImportJobStatus
  totalCount: number
  importedCount: number
  skippedCount: number
  failedCount: number
  createdAt: Date
  updatedAt: Date
}>

export type GbpLocation = Readonly<{
  name: string
  gbpPlaceId: string
  businessName: string
  address: string | null
  primaryCategory: string | null
  latitude: number | null
  longitude: number | null
}>

export type { GoogleConnectionId, GbpImportJobId }
export type { PropertyId } from '#/shared/domain/ids'
