// Test-only: the world, ids and helpers the create-Portal integration suites
// share, so the suites split by subject without repeating the set-up.

import type { Pool } from 'pg'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { createPortal } from './create-portal.server'
import {
  createPortalCreationDeps,
  seedCreationProperty,
  type CreationManager,
} from '../infrastructure/testing/portal-creation-world'
import { createCreationQueries } from './portal-creation-queries.test-fixtures'

export const ORG_A = organizationId('org-createuse-0000-0000-000000000001')
export const ORG_B = organizationId('org-createuse-0000-0000-000000000002')
export const PROPERTY = propertyId('c1a10000-0000-4000-8000-000000000001')
export const OTHER_PROPERTY = propertyId('c1a10000-0000-4000-8000-000000000002')
export const PROPERTY_B = propertyId('c1a10000-0000-4000-8000-00000000000b')
export const GROUP = 'c1a20000-0000-4000-8000-000000000001'
export const GROUP_B = 'c1a20000-0000-4000-8000-00000000000b'
export const SOURCE = 'c1a30000-0000-4000-8000-0000000000a1'
export const SOURCE_B = 'c1a30000-0000-4000-8000-0000000000b1'
export const CATEGORY = 'c1a40000-0000-4000-8000-00000000000a'
export const MENU_LINK = 'c1a50000-0000-4000-8000-000000000001'
export const MENU_DESTINATION = 'c1a60000-0000-4000-8000-000000000001'
export const ID_PREFIX = 'c1d10000'
export const CLOCK = new Date('2026-10-01T12:00:00.000Z')
export const CREATOR = userId('user-createuse-0000-0000-000000000001')
export const OTHER_MANAGER = 'user-createuse-0000-0000-000000000002'
export const MISSING = 'c1a90000-0000-4000-8000-0000000000ff'

export const ctx = buildTestAuthContext({
  organizationId: ORG_A,
  userId: CREATOR,
  role: 'PropertyManager',
})
export const base = { propertyId: String(PROPERTY) }

export const TEST_ORGANIZATIONS = { orgA: ORG_A, orgB: ORG_B }

/** The Properties every test starts with: two in Organization A, one in B. */
export async function seedCreateUseCaseProperties(pool: Pool) {
  for (const [org, property] of [
    [ORG_A, PROPERTY],
    [ORG_A, OTHER_PROPERTY],
    [ORG_B, PROPERTY_B],
  ] as const) {
    await seedCreationProperty(pool, { organizationId: org, propertyId: property })
  }
}

export type WorldOptions = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  managers?: readonly CreationManager[]
}>

export function createCreateUseCaseHarness(getPool: () => Pool) {
  function world(options: WorldOptions = {}) {
    const { deps } = createPortalCreationDeps({
      pool: getPool(),
      idPrefix: ID_PREFIX,
      clock: CLOCK,
      accessible: options.accessible === undefined ? [PROPERTY] : options.accessible,
      managers: options.managers ?? [{ userId: CREATOR, role: 'PropertyManager' }],
      ratingGoalGuard: createPortalRatingGoalGuard(),
    })
    return { deps, create: createPortal(deps) }
  }

  const withBrand = (
    defaultGuestLocales: readonly string[],
    lookVersion = 1,
    property: PropertyId = PROPERTY,
  ) =>
    getPool()
      .query(`DELETE FROM properties WHERE id = $1`, [property])
      .then(() =>
        seedCreationProperty(getPool(), {
          organizationId: ORG_A,
          propertyId: property,
          brand: { displayName: 'Harbor', defaultGuestLocales, lookVersion },
        }),
      )

  return { world, withBrand, ...createCreationQueries(getPool, ORG_A) }
}
