// Staff context — build.ts tests
// Tests the PublicApi behavior and build wiring.

import { describe, it, expect } from 'vitest'
import { buildStaffContext } from './build'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'

// Canonical repositories are constructed at build time. A bare database stub
// is sufficient because these PublicApi tests exercise only injected lookups.
const mockDb = {} as unknown as Database

const mockPortalLookup = {
  listPortalIdsByProperty: async () => [],
  getPortalInfo: async () => null,
}

const idGen = () => '31000000-0000-4000-8000-000000000001'

describe('StaffPublicApi', () => {
  it('does not expose the quarantined Team assignment counter', () => {
    const { publicApi } = buildStaffContext({
      db: mockDb,
      portalLookup: mockPortalLookup,
      clock: () => new Date('2025-01-01'),
      idGen,
      accessiblePropertyLookup: async () => [],
    })

    expect(publicApi).not.toHaveProperty('countAssignmentsByTeam')
  })

  it('returns null for AccountAdmin (all properties accessible)', async () => {
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      db: mockDb,
      portalLookup: mockPortalLookup,
      clock,
      idGen,
      accessiblePropertyLookup: async () => [],
    })

    const result = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('user-1'),
      true,
    )

    expect(result).toBeNull()
  })

  it('resolves accessible property IDs only from the grant lookup port (BQC-2.3)', async () => {
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      db: mockDb,
      portalLookup: mockPortalLookup,
      clock,
      idGen,
      accessiblePropertyLookup: async () => [propertyId('prop-1'), propertyId('prop-2')],
    })

    const result = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('user-1'),
      false,
    )

    expect(result).not.toBeNull()
    expect(result!.map((id) => id as string).sort()).toEqual(['prop-1', 'prop-2'])
  })

  it('missing grants return an empty set — never null (deny downstream)', async () => {
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      db: mockDb,
      portalLookup: mockPortalLookup,
      clock,
      idGen,
      accessiblePropertyLookup: async () => [],
    })

    const result = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('user-1'),
      false,
    )

    expect(result).toEqual([])
  })

  it('lookup failure propagates — fail closed, never silent allow', async () => {
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      db: mockDb,
      portalLookup: mockPortalLookup,
      clock,
      idGen,
      accessiblePropertyLookup: async () => {
        throw new Error('grant store unavailable')
      },
    })

    await expect(
      publicApi.getAccessiblePropertyIds(
        organizationId('org-1'),
        userId('user-1'),
        false,
      ),
    ).rejects.toThrow('grant store unavailable')
  })
})
