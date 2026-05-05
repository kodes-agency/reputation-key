// Shared domain types for integration UI components
// These are simplified types needed by components - the actual domain logic
// lives in contexts/integration/domain/

export type GoogleConnectionVisibility = 'private' | 'organization'

export type GoogleConnectionStatus = 'active' | 'disconnected'

export type GoogleConnection = Readonly<{
  id: string
  organizationId: string
  googleAccountId: string
  googleEmail: string
  status: GoogleConnectionStatus
  visibility: GoogleConnectionVisibility
  connectedBy: string
  connectedAt: Date
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

export type GbpImportJobStatus = 'queued' | 'in_progress' | 'completed' | 'failed'

export type GbpImportJob = Readonly<{
  id: string
  organizationId: string
  initiatedBy: string
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
