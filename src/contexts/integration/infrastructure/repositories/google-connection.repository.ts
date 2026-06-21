// Integration context — Drizzle repository implementation for Google connections
// Per architecture: factory function returning Readonly<{ method }>.
// Filters by organizationId AND visibility/connectedBy for proper access control.

import { and, eq, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleConnections } from '#/shared/db/schema/google-connection.schema'
import type {
  GoogleConnectionRepository,
  ConnectionVisibilityFilter,
} from '../../application/ports/google-connection.repository'
import { uniqueViolationError } from '../../application/ports/google-connection.repository'
import type { PropertyFkCleanupPort } from '../../application/ports/property-fk-cleanup.port'
import {
  googleConnectionFromRow,
  googleConnectionToInsert,
} from '../mappers/google-connection.mapper'
import { trace } from '#/shared/observability/trace'

export const createGoogleConnectionRepository = (
  db: Database,
  propertyFkCleanup: PropertyFkCleanupPort,
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

  listByOrganization: async (orgId, filter: ConnectionVisibilityFilter) => {
    return trace('googleConnection.listByOrganization', async () => {
      const whereClause =
        filter.showAll === true
          ? eq(googleConnections.organizationId, orgId)
          : and(
              eq(googleConnections.organizationId, orgId),
              or(
                eq(googleConnections.visibility, 'organization'),
                eq(googleConnections.connectedBy, filter.userId),
              ),
            )

      const rows = await db.select().from(googleConnections).where(whereClause)
      return rows.map(googleConnectionFromRow)
    })
  },

  insert: async (conn) => {
    return trace('googleConnection.insert', async () => {
      try {
        await db.insert(googleConnections).values(googleConnectionToInsert(conn))
      } catch (err) {
        const isPg23505 =
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        if (isPg23505) {
          throw uniqueViolationError(
            `Duplicate google connection for accountId=${conn.googleAccountId}`,
          )
        }
        throw err
      }
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
      // Null out FK references first (port belongs to another context — no tx passthrough)
      await propertyFkCleanup.clearGoogleConnectionRef(orgId, id)

      await db.transaction(async (tx) => {
        await tx
          .delete(googleConnections)
          .where(
            and(
              eq(googleConnections.organizationId, orgId),
              eq(googleConnections.id, id),
            ),
          )
      })
    })
  },
})
