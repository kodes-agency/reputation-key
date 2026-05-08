// Integration context — Drizzle repository implementation for Google connections
// Per architecture: factory function returning Readonly<{ method }>.
// Filters by organizationId AND visibility/connectedBy for proper access control.

import { and, eq, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import type { GoogleConnectionRepository } from '../../application/ports/google-connection.repository'
import {
  googleConnectionFromRow,
  googleConnectionToInsert,
} from '../mappers/google-connection.mapper'
import { trace } from '#/shared/observability/trace'
import { hasRole } from '#/shared/domain/roles'

export const createGoogleConnectionRepository = (
  db: Database,
): GoogleConnectionRepository => ({
  findById: async (orgId, id) => {
    return trace('googleConnection.findById', async () => {
      const rows = await db
        .select()
        .from(googleConnections)
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
        .limit(1)
      return rows[0] ? googleConnectionFromRow(rows[0]) : null
    })
  },

  findByGoogleAccountId: async (orgId, googleAccountId) => {
    return trace('googleConnection.findByGoogleAccountId', async () => {
      const rows = await db
        .select()
        .from(googleConnections)
        .where(
          and(
            eq(googleConnections.organizationId, orgId),
            eq(googleConnections.googleAccountId, googleAccountId),
          ),
        )
        .limit(1)
      return rows[0] ? googleConnectionFromRow(rows[0]) : null
    })
  },

  listByOrganization: async (orgId, userId, role) => {
    return trace('googleConnection.listByOrganization', async () => {
      const isAdminOrOwner = hasRole(role, 'AccountAdmin')

      const whereClause = isAdminOrOwner
        ? eq(googleConnections.organizationId, orgId)
        : and(
            eq(googleConnections.organizationId, orgId),
            or(
              eq(googleConnections.visibility, 'organization'),
              eq(googleConnections.connectedBy, userId),
            ),
          )

      const rows = await db.select().from(googleConnections).where(whereClause)
      return rows.map(googleConnectionFromRow)
    })
  },

  insert: async (conn) => {
    return trace('googleConnection.insert', async () => {
      await db.insert(googleConnections).values(googleConnectionToInsert(conn))
    })
  },

  updateTokens: async (orgId, id, accessToken, refreshToken, expiresAt) => {
    return trace('googleConnection.updateTokens', async () => {
      await db
        .update(googleConnections)
        .set({
          encryptedAccessToken: accessToken,
          encryptedRefreshToken: refreshToken,
          tokenExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
    })
  },

  updateTokensAndStatus: async (
    orgId,
    id,
    accessToken,
    refreshToken,
    expiresAt,
    status,
  ) => {
    return trace('googleConnection.updateTokensAndStatus', async () => {
      await db
        .update(googleConnections)
        .set({
          encryptedAccessToken: accessToken,
          encryptedRefreshToken: refreshToken,
          tokenExpiresAt: expiresAt,
          status,
          updatedAt: new Date(),
        })
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
    })
  },

  updateStatus: async (orgId, id, status) => {
    return trace('googleConnection.updateStatus', async () => {
      await db
        .update(googleConnections)
        .set({
          status,
          updatedAt: new Date(),
        })
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
    })
  },

  updateVisibility: async (orgId, id, visibility) => {
    return trace('googleConnection.updateVisibility', async () => {
      await db
        .update(googleConnections)
        .set({
          visibility,
          updatedAt: new Date(),
        })
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
    })
  },

  updateReconnection: async (
    orgId,
    id,
    accessToken,
    refreshToken,
    expiresAt,
    visibility,
  ) => {
    return trace('googleConnection.updateReconnection', async () => {
      await db
        .update(googleConnections)
        .set({
          encryptedAccessToken: accessToken,
          encryptedRefreshToken: refreshToken,
          tokenExpiresAt: expiresAt,
          status: 'active',
          visibility,
          updatedAt: new Date(),
        })
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
    })
  },

  delete: async (orgId, id) => {
    return trace('googleConnection.delete', async () => {
      await db
        .delete(googleConnections)
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
    })
  },
})
