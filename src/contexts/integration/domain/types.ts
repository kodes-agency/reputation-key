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

export type GoogleConnectionStatus =
  | 'pending'
  | 'active'
  | 'degraded'
  | 'reauth_required'
  | 'disconnecting'
  | 'disconnected'
  | 'failed'

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
  // B1.6: Token key versioning + health tracking
  encryptionKeyId: string
  lastSuccessfulSyncAt: Date | null
  statusReason: string | null
  statusChangedAt: Date | null
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
  /** ISO 3166-1 alpha-2 from storefrontAddress.regionCode when present (BQR-3.5). */
  countryCode: string | null
}>

export type { GoogleConnectionId, GbpImportJobId }
export type { PropertyId } from '#/shared/domain/ids'
