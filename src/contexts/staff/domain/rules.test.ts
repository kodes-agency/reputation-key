// Staff context — domain rules tests
// Authorization checks have been moved to the centralized permission system.
// These tests verify the permission table entries for staff_assignment actions.

import { describe, it, expect } from 'vitest'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'

// ── staff_assignment.create/delete permissions ──────────────────────

describe('staff_assignment.create permission', () => {
  it('allows AccountAdmin and PropertyManager', () => {
    expect(can('AccountAdmin', 'staff_assignment.create')).toBe(true)
    expect(can('PropertyManager', 'staff_assignment.create')).toBe(true)
  })

  it('rejects Staff', () => {
    expect(can('Staff', 'staff_assignment.create')).toBe(false)
  })
})

describe('staff_assignment.delete permission', () => {
  it('allows AccountAdmin and PropertyManager', () => {
    expect(can('AccountAdmin', 'staff_assignment.delete')).toBe(true)
    expect(can('PropertyManager', 'staff_assignment.delete')).toBe(true)
  })

  it('rejects Staff', () => {
    expect(can('Staff', 'staff_assignment.delete')).toBe(false)
  })

  it('exhaustively covers all roles for staff_assignment.create', () => {
    const roles: Role[] = ['AccountAdmin', 'PropertyManager', 'Staff']
    const expected: Record<Role, boolean> = {
      AccountAdmin: true,
      PropertyManager: true,
      Staff: false,
    }
    for (const role of roles) {
      expect(can(role, 'staff_assignment.create')).toBe(expected[role])
    }
  })
})
