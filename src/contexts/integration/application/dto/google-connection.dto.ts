// Integration context — GoogleConnection DTO
// Strips sensitive token fields before returning to API consumers.
// Per architecture: server functions map domain → DTO at the boundary.

import type {
  GoogleConnection,
  GoogleConnectionStatus,
  GoogleConnectionVisibility,
} from '../../domain/types'

export type GoogleConnectionDto = Readonly<{
  id: string
  organizationId: string
  googleAccountId: string
  googleEmail: string
  scopes: ReadonlyArray<string>
  connectedBy: string
  visibility: GoogleConnectionVisibility
  status: GoogleConnectionStatus
  createdAt: Date
  updatedAt: Date
}>

/** Map domain GoogleConnection → safe DTO (no encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt). */
export function toGoogleConnectionDto(conn: GoogleConnection): GoogleConnectionDto {
  return {
    id: conn.id,
    organizationId: conn.organizationId,
    googleAccountId: conn.googleAccountId,
    googleEmail: conn.googleEmail,
    scopes: conn.scopes,
    connectedBy: conn.connectedBy,
    visibility: conn.visibility,
    status: conn.status,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  }
}
