// Staff context — build.ts tests
// Tests the PublicApi behavior and build wiring.

import { describe, it, expect } from 'vitest'
import { buildStaffContext } from './build'
import { createInMemoryStaffAssignmentRepo } from '#/shared/testing/in-memory-staff-assignment-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  organizationId,
  propertyId,
  userId,
  staffAssignmentId,
} from '#/shared/domain/ids'
import type { StaffAssignment } from './domain/types'

const mockPortalLookup = {
  listPortalIdsByProperty: async () => [],
  getPortalInfo: async () => null,
}

const mockIdentityMembership = {
  isMember: async () => true,
}

const seedAssignment = (overrides: Partial<StaffAssignment> = {}): StaffAssignment =>
  ({
    id: staffAssignmentId('staff-1'),
    organizationId: organizationId('org-1'),
    userId: userId('user-1'),
    propertyId: propertyId('prop-1'),
    teamId: null,
    portalId: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
    ...overrides,
  }) as StaffAssignment

describe('StaffPublicApi', () => {
  it('returns null for AccountAdmin (all properties accessible)', async () => {
    const repo = createInMemoryStaffAssignmentRepo()
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      repo,
      portalLookup: mockPortalLookup,
      events,
      clock,
      identityMembership: mockIdentityMembership,
      accessiblePropertyLookup: async () => [],
    })

    const result = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('user-1'),
      true,
    )

    expect(result).toBeNull()
  })

  it('resolves accessible property IDs from the grant lookup port (BQC-2.3)', async () => {
    const repo = createInMemoryStaffAssignmentRepo()
    // Deliberately seed a staff assignment that the grant lookup does NOT
    // return — participation alone must not produce access.
    repo.seed([
      seedAssignment({
        id: staffAssignmentId('staff-1'),
        userId: userId('user-1'),
        propertyId: propertyId('prop-staff-only'),
      }),
    ])
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      repo,
      portalLookup: mockPortalLookup,
      events,
      clock,
      identityMembership: mockIdentityMembership,
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
    const repo = createInMemoryStaffAssignmentRepo()
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      repo,
      portalLookup: mockPortalLookup,
      events,
      clock,
      identityMembership: mockIdentityMembership,
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
    const repo = createInMemoryStaffAssignmentRepo()
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      repo,
      portalLookup: mockPortalLookup,
      events,
      clock,
      identityMembership: mockIdentityMembership,
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
