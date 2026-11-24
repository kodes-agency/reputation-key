import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import { unbrand, type OrganizationId, type PropertyId } from '#/shared/domain/ids'
import { localDateOf } from '../domain/local-days'

export const createPropertyLocalDateResolver =
  (db: Database) =>
  async (
    propertyId: PropertyId,
    organizationId: OrganizationId,
    at: Date,
  ): Promise<string> => {
    const rows = await db
      .select({ timezone: properties.timezone })
      .from(properties)
      .where(
        and(
          eq(properties.id, unbrand(propertyId)),
          eq(properties.organizationId, unbrand(organizationId)),
        ),
      )
      .limit(1)
    const timezone = rows[0]?.timezone
    if (!timezone)
      throw new Error(`Property timezone unavailable: ${unbrand(propertyId)}`)
    return localDateOf(at, timezone)
  }
