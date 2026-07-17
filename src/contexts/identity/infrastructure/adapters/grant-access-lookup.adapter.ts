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
import { listActiveGrantsForUser } from '../repositories/property-access-grant.repository'
import { getPolicyVersion } from '../repositories/policy-state.repository'
import type { AccessiblePropertyLookupPort } from '#/contexts/staff/application/ports/accessible-property-lookup.port'

const CACHE_TTL_MS = 60_000
const CACHE_MAX_SIZE = 200

export function createGrantAccessLookup(db: Database): AccessiblePropertyLookupPort {
  const cache = new Map<string, { ids: ReadonlyArray<PropertyId>; ts: number }>()

  return async (orgId: OrganizationId, userId: UserId) => {
    // Cheap PK read per call — the version IS the invalidation token.
    const version = await getPolicyVersion(db)
    const key = `${orgId}:${userId}:${version}`
    const cached = cache.get(key)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.ids

    const grants = await listActiveGrantsForUser(db, orgId, userId, new Date())
    const ids = [...new Set(grants.map((g) => propertyId(g.propertyId)))]
    if (cache.size >= CACHE_MAX_SIZE) cache.clear()
    cache.set(key, { ids, ts: Date.now() })
    return ids
  }
}
