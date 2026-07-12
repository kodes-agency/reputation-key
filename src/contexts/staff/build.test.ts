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
import type { PropertyId } from '#/shared/domain/ids'
import type { StaffAssignment } from './domain/types'
import {
  getCachedAccessiblePropertySet,
  setCachedAccessiblePropertySet,
} from '#/shared/auth/middleware'

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
    })

    const result = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('user-1'),
      true,
    )

    expect(result).toBeNull()
  })

  it('returns accessible property IDs from repo for PropertyManager', async () => {
    const repo = createInMemoryStaffAssignmentRepo()
    repo.seed([
      seedAssignment({
        id: staffAssignmentId('staff-1'),
        userId: userId('user-1'),
        propertyId: propertyId('prop-1'),
      }),
      seedAssignment({
        id: staffAssignmentId('staff-2'),
        userId: userId('user-1'),
        propertyId: propertyId('prop-2'),
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
    })

    const result = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('user-1'),
      false,
    )

    expect(result).not.toBeNull()
    expect(result!.map((id) => id as string).sort()).toEqual(['prop-1', 'prop-2'])
  })

  it('property set cache (org:user:version) hit/miss/invalidation works (AC-04)', async () => {
    const org = 'org-cache-test'
    const user = 'user-cache-test'
    const ver = 42

    expect(getCachedAccessiblePropertySet(org, user, ver)).toBeUndefined()

    const sample: ReadonlyArray<PropertyId> = [propertyId('p-x')]
    setCachedAccessiblePropertySet(org, user, ver, sample)

    expect(getCachedAccessiblePropertySet(org, user, ver)).toEqual(sample)

    // Different version is a miss (simulates bump / invalidation)
    expect(getCachedAccessiblePropertySet(org, user, ver + 1)).toBeUndefined()
  })

  it('caches through publicApi (avoids repo on hit)', async () => {
    const repo = createInMemoryStaffAssignmentRepo()
    repo.seed([seedAssignment({ userId: userId('u1'), propertyId: propertyId('p1') })])
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({
      repo,
      portalLookup: mockPortalLookup,
      events,
      clock,
      identityMembership: mockIdentityMembership,
    })

    const repoSpy = vi.spyOn(repo, 'getAccessiblePropertyIds')

    const first = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('u1'),
      false,
    )
    const second = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('u1'),
      false,
    )

    expect(first).toEqual(second)
    expect(repoSpy).toHaveBeenCalledTimes(1) // second was cache hit
  })
})
