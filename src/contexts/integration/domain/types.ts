// Integration context — domain types
// Per architecture: types are data only — no methods, no classes.
// readonly on every field. Branded IDs prevent accidental substitution.

import type { OrganizationId, UserId, GoogleConnectionId } from '#/shared/domain/ids'

export type GoogleConnectionVisibility = 'private' | 'organization'
export type GoogleCredentialUseState = 'active' | 'cleanup_only' | 'none'

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
  googleSubject: string | null
  encryptedAccessToken: string
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  scopes: ReadonlyArray<string>
  /** AccountAdmin who completed the current OAuth grant. */
  credentialAuthorizedBy: UserId
  /** Immutable first-connection provenance; never used as current authority. */
  connectedBy: UserId
  visibility: GoogleConnectionVisibility
  status: GoogleConnectionStatus
  credentialUseState: GoogleCredentialUseState
  cleanupMaterialDeadlineAt: Date | null
  lifecycleVersion: number
  accessVersion: number
  credentialGeneration: number
  // B1.6: Token key versioning + health tracking
  encryptionKeyId: string
  lastSuccessfulSyncAt: Date | null
  statusReason: string | null
  statusChangedAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

export type { GoogleConnectionId }
