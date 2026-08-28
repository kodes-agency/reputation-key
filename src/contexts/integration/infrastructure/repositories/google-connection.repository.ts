// Integration context — Drizzle repository implementation for Google connections
// Per architecture: factory function returning Readonly<{ method }>.
// Filters by organizationId; connectedBy is audit provenance, not authority.

import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
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
  clock: Clock,
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

  findByGoogleIdentity: async (orgId, identity) => {
    return trace('googleConnection.findByGoogleIdentity', async () => {
      const identityFilter = eq(googleConnections.googleSubject, identity.googleSubject)
      const rows = await db
        .select()
        .from(googleConnections)
        .where(and(eq(googleConnections.organizationId, orgId), identityFilter))
        .limit(1)
      return rows[0] ? googleConnectionFromRow(rows[0]) : null
    })
  },

  findByGoogleIdentityGlobal: async (identity) => {
    return trace('googleConnection.findByGoogleIdentityGlobal', async () => {
      const identityFilter = eq(googleConnections.googleSubject, identity.googleSubject)
      const rows = await db
        .select()
        .from(googleConnections)
        .where(identityFilter)
        .limit(1)
      return rows[0] ? googleConnectionFromRow(rows[0]) : null
    })
  },

  listByOrganization: async (orgId, _filter: ConnectionVisibilityFilter) => {
    return trace('googleConnection.listByOrganization', async () => {
      const rows = await db
        .select()
        .from(googleConnections)
        .where(eq(googleConnections.organizationId, orgId))
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
          throw uniqueViolationError('Duplicate Google connection identity')
        }
        throw err
      }
    })
  },

  updateTokens: async (orgId, id, expected, accessToken, refreshToken, expiresAt) => {
    return trace('googleConnection.updateTokens', async () => {
      const rows = await db
        .update(googleConnections)
        .set({
          encryptedAccessToken: accessToken,
          encryptedRefreshToken: refreshToken,
          tokenExpiresAt: expiresAt,
          credentialGeneration: sql`${googleConnections.credentialGeneration} + 1`,
          updatedAt: clock(),
        })
        .where(
          and(
            eq(googleConnections.organizationId, orgId),
            eq(googleConnections.id, id),
            eq(googleConnections.credentialUseState, 'active'),
            eq(googleConnections.lifecycleVersion, expected.lifecycleVersion),
            eq(googleConnections.credentialGeneration, expected.credentialGeneration),
          ),
        )
        .returning({ id: googleConnections.id })
      return rows.length === 1
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
          credentialGeneration: sql`${googleConnections.credentialGeneration} + 1`,
          accessVersion: sql`${googleConnections.accessVersion} + 1`,
          updatedAt: clock(),
        })
        .where(
          and(
            eq(googleConnections.organizationId, orgId),
            eq(googleConnections.id, id),
            eq(googleConnections.credentialUseState, 'active'),
          ),
        )
    })
  },

  updateStatus: async (orgId, id, status) => {
    return trace('googleConnection.updateStatus', async () => {
      await db
        .update(googleConnections)
        .set({
          status,
          lifecycleVersion: sql`${googleConnections.lifecycleVersion} + 1`,
          updatedAt: clock(),
        })
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
    })
  },

  redactForDisconnect: async (orgId, id) => {
    return trace('googleConnection.redactForDisconnect', async () => {
      await db
        .update(googleConnections)
        .set({
          encryptedAccessToken: 'redacted',
          encryptedRefreshToken: 'redacted',
          googleSubject: null,
          scopes: [],
          credentialUseState: 'none',
          cleanupMaterialDeadlineAt: null,
          lifecycleVersion: sql`${googleConnections.lifecycleVersion} + 1`,
          accessVersion: sql`${googleConnections.accessVersion} + 1`,
          credentialGeneration: sql`${googleConnections.credentialGeneration} + 1`,
          updatedAt: clock(),
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
          accessVersion: sql`${googleConnections.accessVersion} + 1`,
          updatedAt: clock(),
        })
        .where(
          and(eq(googleConnections.organizationId, orgId), eq(googleConnections.id, id)),
        )
    })
  },

  updateReconnection: async (
    orgId,
    id,
    googleSubject,
    accessToken,
    refreshToken,
    expiresAt,
    visibility,
    scopes,
    credentialHome,
    credentialAuthorizedBy,
    credentialAuthorizedAt,
  ) => {
    return trace('googleConnection.updateReconnection', async () => {
      await db
        .update(googleConnections)
        .set({
          googleSubject,
          encryptedAccessToken: accessToken,
          encryptedRefreshToken: refreshToken,
          tokenExpiresAt: expiresAt,
          status: 'active',
          visibility,
          scopes: [...scopes],
          credentialAuthorizedBy,
          credentialAuthorizedAt,
          credentialUseState: 'active',
          credentialHomeCellId: credentialHome.homeCellId,
          credentialHomePolicyVersion: credentialHome.cataloguePolicyVersion,
          credentialHomeAuthorityGeneration: credentialHome.authorityGeneration,
          cleanupMaterialDeadlineAt: null,
          lifecycleVersion: sql`${googleConnections.lifecycleVersion} + 1`,
          accessVersion: sql`${googleConnections.accessVersion} + 1`,
          credentialGeneration: sql`${googleConnections.credentialGeneration} + 1`,
          updatedAt: clock(),
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
