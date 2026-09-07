// Grant-backed accessible-property lookup (identity-owned).
//
// Reads property_access_grant live on every decision. Grants are the sole
// authorization source for property scope, so a committed grant or revocation
// is visible without a cache-generation side channel.

import type { Database } from '#/shared/db'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { propertyId } from '#/shared/domain/ids'
import {
  listActiveGrantUserIdsForProperty,
  listActiveGrantsForUser,
} from '../repositories/property-access-grant.repository'
import type { AccessiblePropertyLookupPort } from '#/contexts/staff/application/ports/accessible-property-lookup.port'


export const createGrantAccessLookup = (
  db: Database,
  clock: () => Date,
): AccessiblePropertyLookupPort => {
  return async (orgId: OrganizationId, uid: UserId) => {
    const grants = await listActiveGrantsForUser(db, orgId, uid, clock())
    return [...new Set(grants.map((grant) => propertyId(grant.propertyId)))]
  }
}

/**
 * Inverse lookup: users holding active access to one property. Identity owns
 * the grant table, so property-scoped fan-out in other contexts (notification
 * recipients) consumes this adapter instead of querying grants directly.
 */
export type PropertyGrantHolderLookup = (
  organizationId: string,
  propertyId: string,
) => Promise<ReadonlyArray<string>>

export const createPropertyGrantHolderLookup = (
  db: Database,
  clock: () => Date,
): PropertyGrantHolderLookup => {
  return async (organizationId, property) =>
    listActiveGrantUserIdsForProperty(db, {
      organizationId,
      propertyId: property,
      at: clock(),
    })
}
