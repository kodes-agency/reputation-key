// Integration context — row ↔ domain mapper for Google connections
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { googleConnections } from '#/shared/db/schema/google-connection.schema'
import type { GoogleConnection } from '../../domain/types'
import { unbrand } from '#/shared/domain/ids'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'

type GoogleConnectionRow = typeof googleConnections.$inferSelect
type GoogleConnectionInsertRow = typeof googleConnections.$inferInsert

export const googleConnectionFromRow = (row: GoogleConnectionRow): GoogleConnection => ({
  id: googleConnectionId(row.id),
  organizationId: organizationId(row.organizationId),
  googleSubject: row.googleSubject,
  encryptedAccessToken: row.encryptedAccessToken,
  encryptedRefreshToken: row.encryptedRefreshToken,
  tokenExpiresAt: row.tokenExpiresAt,
  scopes: Object.freeze(row.scopes),
  credentialAuthorizedBy: userId(row.credentialAuthorizedBy ?? row.connectedBy),
  connectedBy: userId(row.connectedBy),
  visibility: row.visibility,
  status: row.status,
  credentialUseState: row.credentialUseState,
  cleanupMaterialDeadlineAt: row.cleanupMaterialDeadlineAt,
  lifecycleVersion: row.lifecycleVersion,
  accessVersion: row.accessVersion,
  credentialGeneration: row.credentialGeneration,
  encryptionKeyId: row.encryptionKeyId,
  lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
  statusReason: row.statusReason,
  statusChangedAt: row.statusChangedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const googleConnectionToInsert = (
  conn: GoogleConnection,
): GoogleConnectionInsertRow => ({
  id: unbrand(conn.id),
  organizationId: unbrand(conn.organizationId),
  googleSubject: conn.googleSubject,
  encryptedAccessToken: conn.encryptedAccessToken,
  encryptedRefreshToken: conn.encryptedRefreshToken,
  tokenExpiresAt: conn.tokenExpiresAt,
  scopes: [...conn.scopes],
  connectedBy: unbrand(conn.connectedBy),
  credentialAuthorizedBy: unbrand(conn.credentialAuthorizedBy),
  credentialAuthorizedAt: conn.createdAt,
  visibility: conn.visibility,
  status: conn.status,
  credentialUseState: conn.credentialUseState,
  cleanupMaterialDeadlineAt: conn.cleanupMaterialDeadlineAt,
  lifecycleVersion: conn.lifecycleVersion,
  accessVersion: conn.accessVersion,
  credentialGeneration: conn.credentialGeneration,
  encryptionKeyId: conn.encryptionKeyId,
  lastSuccessfulSyncAt: conn.lastSuccessfulSyncAt,
  statusReason: conn.statusReason,
  statusChangedAt: conn.statusChangedAt,
  createdAt: conn.createdAt,
  updatedAt: conn.updatedAt,
})
