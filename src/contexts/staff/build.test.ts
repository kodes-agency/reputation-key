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

const seedAssignment = (overrides: Partial<StaffAssignment> = {}): StaffAssignment => ({
  id: staffAssignmentId('staff-1'),
  organizationId: organizationId('org-1'),
  userId: userId('user-1'),
  propertyId: propertyId('prop-1'),
  teamId: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  deletedAt: null,
  ...overrides,
})

describe('StaffPublicApi', () => {
  it('returns null for AccountAdmin (all properties accessible)', async () => {
    const repo = createInMemoryStaffAssignmentRepo()
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')

    const { publicApi } = buildStaffContext({ repo, events, clock })

    const result = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('user-1'),
      'AccountAdmin',
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

    const { publicApi } = buildStaffContext({ repo, events, clock })

    const result = await publicApi.getAccessiblePropertyIds(
      organizationId('org-1'),
      userId('user-1'),
      'PropertyManager',
    )

    expect(result).not.toBeNull()
    expect(result!.map((id) => id as string).sort()).toEqual(['prop-1', 'prop-2'])
  })
})
