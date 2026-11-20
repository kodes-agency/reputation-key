// The country of the Property a print kit is made for: it says where the piece
// will stand, so it sets the paper a print defaults to (Letter in the US and the
// other Letter countries, and when the country is unknown; A4 elsewhere; spec
// 7.1). Read the way the working copy reads the Property's time zone, scoped to
// the Organization; null when the Property has no country recorded.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema/property.schema'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type PropertyCountryReader = (
  organizationId: OrganizationId,
  propertyId: PropertyId,
) => Promise<string | null>

export function createPropertyCountryReader(
  db: Pick<Database, 'select'>,
): PropertyCountryReader {
  return async (organizationId, propertyId) => {
    const [property] = await db
      .select({ countryCode: properties.countryCode })
      .from(properties)
      .where(
        and(eq(properties.organizationId, organizationId), eq(properties.id, propertyId)),
      )
      .limit(1)
    return property?.countryCode ?? null
  }
}
