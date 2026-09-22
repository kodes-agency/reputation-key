// Database adapter for the DisplayNameLookupPort. Feed already reads the
// `properties` row for render facts (inbox-item-lookup.adapter.ts) and the
// Better Auth identity tables for recipients; this reads only display names.
import type { Database } from '#/shared/db'
import { and, eq } from 'drizzle-orm'
import { organization } from '#/shared/db/schema/auth'
import { properties } from '#/shared/db/schema/property.schema'
import { unbrand, type OrganizationId, type PropertyId } from '#/shared/domain/ids'
import type { DisplayNameLookupPort } from '../../application/ports/notification-display-name-lookup.port'

export const createDisplayNameLookupAdapter = (db: Database): DisplayNameLookupPort => ({
  async findPropertyName(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<string | null> {
    const rows = await db
      .select({ name: properties.name })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, unbrand(organizationId)),
          eq(properties.id, unbrand(propertyId)),
        ),
      )
      .limit(1)
    return rows[0]?.name ?? null
  },

  async findOrganizationName(organizationId: OrganizationId): Promise<string | null> {
    const rows = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, unbrand(organizationId)))
      .limit(1)
    return rows[0]?.name ?? null
  },
})
