import { describe, expect, it } from 'vitest'
import { createStaffParticipant } from './staff-participant'

describe('StaffParticipant', () => {
  it('creates an active profile without requiring a login identity', () => {
    const now = new Date('2026-08-25T12:00:00.000Z')
    const participant = createStaffParticipant({
      id: 'participant-1',
      organizationId: 'org-1',
      displayName: 'Alex Morgan',
      createdBy: 'manager-1',
      now,
    })

    expect(participant).toEqual({
      id: 'participant-1',
      organizationId: 'org-1',
      displayName: 'Alex Morgan',
      status: 'active',
      archivedAt: null,
      archiveReason: null,
      revision: 1,
      createdBy: 'manager-1',
      createdAt: now,
      updatedAt: now,
    })
    expect(participant).not.toHaveProperty('userId')
  })
})
