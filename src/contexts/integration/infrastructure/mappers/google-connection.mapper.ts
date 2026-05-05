// Integration context — row ↔ domain mapper for Google connections
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { googleConnections } from '#/shared/db/schema/google-connection.schema'
import type { GoogleConnection } from '../../domain/types'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'

type GoogleConnectionRow = typeof googleConnections.$inferSelect
type GoogleConnectionInsertRow = typeof googleConnections.$inferInsert

export const googleConnectionFromRow = (row: GoogleConnectionRow): GoogleConnection => ({
  id: googleConnectionId(row.id),
  organizationId: organizationId(row.organizationId),
  googleAccountId: row.googleAccountId,
  googleEmail: row.googleEmail,
  encryptedAccessToken: row.encryptedAccessToken,
  encryptedRefreshToken: row.encryptedRefreshToken,
  tokenExpiresAt: row.tokenExpiresAt,
  scopes: Object.freeze(row.scopes),
  connectedBy: userId(row.connectedBy),
  visibility: row.visibility,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const googleConnectionToInsert = (conn: GoogleConnection): GoogleConnectionInsertRow => ({
  id: conn.id,
  organizationId: conn.organizationId,
  googleAccountId: conn.googleAccountId,
  googleEmail: conn.googleEmail,
  encryptedAccessToken: conn.encryptedAccessToken,
  encryptedRefreshToken: conn.encryptedRefreshToken,
  tokenExpiresAt: conn.tokenExpiresAt,
  scopes: [...conn.scopes],
  connectedBy: conn.connectedBy,
  visibility: conn.visibility,
  status: conn.status,
  createdAt: conn.createdAt,
  updatedAt: conn.updatedAt,
})
