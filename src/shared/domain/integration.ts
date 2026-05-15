// Shared domain types for integration UI components
// These are simplified types needed by components - the actual domain logic
// lives in contexts/integration/domain/
import type { GoogleConnectionId, GbpImportJobId, UserId } from './ids'

export type GoogleConnectionVisibility = 'private' | 'organization'

export type GoogleConnectionStatus = 'active' | 'disconnected'

export type GoogleConnection = Readonly<{
  id: GoogleConnectionId
  organizationId: string
  googleAccountId: string
  googleEmail: string
  status: GoogleConnectionStatus
  visibility: GoogleConnectionVisibility
  connectedBy: UserId
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

export type GbpImportJobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'completed_with_skips'
  | 'completed_with_failures'
  | 'failed'

export type GbpImportJob = Readonly<{
  id: GbpImportJobId
  organizationId: string
  initiatedBy: UserId
  status: GbpImportJobStatus
  totalCount: number
  importedCount: number
  skippedCount: number
  failedCount: number
  createdAt: Date
  updatedAt: Date
}>

export type GbpCacheEntry = Readonly<{
  id: string
  propertyId: string
  gbpPlaceId: string
  dataType: 'location' | 'reviews'
  payload: unknown
  googleAttribution: string | null
  fetchedAt: Date
  expiresAt: Date
}>
