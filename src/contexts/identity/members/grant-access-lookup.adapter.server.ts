// Grant-backed accessible-property lookup (identity-owned).
//
// Reads property_access_grant live on every decision. Grants are the sole
// authorization source for property scope, so a committed grant or revocation
// is visible without a cache-generation side channel.

import type { Database } from '#/shared/db/index'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { propertyId } from '#/shared/domain/ids'
import { listActiveGrantsForUser } from './property-access-grant-repository.server'

/**
 * The only source of property-access scope: the caller's granted Property ids,
 * empty when there are none (missing scope denies downstream). A failed lookup
 * throws, failing the request closed.
 */
export type AccessiblePropertyLookup = (
  orgId: OrganizationId,
  userId: UserId,
) => Promise<ReadonlyArray<PropertyId>>

export const createGrantAccessLookup = (
  db: Pick<Database, 'execute'>,
  clock: () => Date,
): AccessiblePropertyLookup => {
  return async (orgId: OrganizationId, uid: UserId) => {
    const grants = await listActiveGrantsForUser(db, orgId, uid, clock())
    return [...new Set(grants.map((grant) => propertyId(grant.propertyId)))]
  }
}
