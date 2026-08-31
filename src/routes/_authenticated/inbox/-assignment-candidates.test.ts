import { describe, expect, it } from 'vitest'
import '#/shared/auth/permissions'
import {
  canListInboxAssignmentCandidates,
  toInboxAssignmentOptions,
} from './-assignment-candidates'

describe('Inbox assignment candidates', () => {
  it('never requests the member directory for a role without member.list', () => {
    expect(canListInboxAssignmentCandidates('AccountAdmin')).toBe(true)
    expect(canListInboxAssignmentCandidates('PropertyManager')).toBe(true)
    expect(canListInboxAssignmentCandidates('Staff')).toBe(false)
  })

  it('uses the canonical beta interactive-role guard and neutral name fallback', () => {
    expect(
      toInboxAssignmentOptions([
        {
          userId: 'owner-1',
          role: 'AccountAdmin',
          name: '  Owner Name  ',
          email: 'owner@example.com',
        },
        {
          userId: 'manager-1',
          role: 'PropertyManager',
          name: null,
          email: 'manager@example.com',
        },
        {
          userId: 'staff-1',
          role: 'Staff',
          name: 'Staff Name',
          email: 'staff@example.com',
        },
        {
          userId: 'quarantined-1',
          role: null,
          name: 'Quarantined Role',
          email: 'quarantined@example.com',
        },
      ]),
    ).toEqual([
      { userId: 'owner-1', name: 'Owner Name' },
      { userId: 'manager-1', name: 'manager@example.com' },
    ])
  })
})
