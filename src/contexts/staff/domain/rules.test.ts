// Staff context — domain rules tests
// Authorization checks have been moved to the centralized permission system.
// These tests verify the permission table entries for staff_assignment actions
// and the pure validation rules in domain/rules.ts.

import { describe, it, expect } from 'vitest'
import { can } from '#/shared/domain/permissions'
import { validateNotSelfAssignment } from './rules'
import { userId } from '#/shared/domain/ids'
import { isStaffError } from './errors'

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
})

// ── Domain validation rules ─────────────────────────────────────────

describe('validateNotSelfAssignment', () => {
  it('returns ok when target and acting user differ', () => {
    const target = userId('user-aaa')
    const acting = userId('user-bbb')
    const result = validateNotSelfAssignment(target, acting)
    expect(result.isOk()).toBe(true)
  })

  it('returns err when target and acting user are the same', () => {
    const same = userId('user-aaa')
    const result = validateNotSelfAssignment(same, same)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(isStaffError(result.error)).toBe(true)
      expect(result.error.code).toBe('invalid_input')
    }
  })
})
