// Database adapter for the PropertyNameLookupPort. Feed already reads the
// `properties` row for render facts (inbox-item-lookup.adapter.ts) and for the
// recipient's delivery scope; this reads only the display name.
import type { Database } from '#/shared/db'
import { and, eq } from 'drizzle-orm'
import { properties } from '#/shared/db/schema/property.schema'
import { unbrand, type OrganizationId, type PropertyId } from '#/shared/domain/ids'
import type { PropertyNameLookupPort } from '../../application/ports/notification-property-name-lookup.port'

export const createPropertyNameLookupAdapter = (
  db: Database,
): PropertyNameLookupPort => ({
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
})
