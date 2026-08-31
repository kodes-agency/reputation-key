// BQC-2.3 — grant-backed accessible-property lookup (identity-owned).
//
// Reads only property_access_grant (active, unexpired) — ADR 0039: explicit
// grants are the sole authorization source for property scope. Cache is
// keyed on the global policy_version (grants bump it in the same statement),
// so a grant or revoke is visible on the very next call; TTL is only a
// fallback bound. Mirrors the AC-04 version-keyed pattern that previously
// cached the staff_assignment-derived set in middleware.ts.

import type { Database } from '#/shared/db'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { propertyId } from '#/shared/domain/ids'
import {
  listActiveGrantUserIdsForProperty,
  listActiveGrantsForUser,
} from '../repositories/property-access-grant.repository'
import { getPolicyVersion } from '../repositories/policy-state.repository'
import type { AccessiblePropertyLookupPort } from '#/contexts/staff/application/ports/accessible-property-lookup.port'

const CACHE_TTL_MS = 60_000
const CACHE_MAX_SIZE = 200

export const createGrantAccessLookup = (
  db: Database,
  clock: () => Date,
): AccessiblePropertyLookupPort => {
  const cache = new Map<string, { ids: ReadonlyArray<PropertyId>; ts: number }>()

  return async (orgId: OrganizationId, userId: UserId) => {
    const now = clock()
    // Cheap PK read per call — the version IS the invalidation token.
    const version = await getPolicyVersion(db)
    const key = `${orgId}:${userId}:${version}`
    const cached = cache.get(key)
    if (cached && now.getTime() - cached.ts < CACHE_TTL_MS) return cached.ids

    const grants = await listActiveGrantsForUser(db, orgId, userId, now)
    const ids = [...new Set(grants.map((g) => propertyId(g.propertyId)))]
    if (cache.size >= CACHE_MAX_SIZE) cache.clear()
    cache.set(key, { ids, ts: now.getTime() })
    return ids
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
