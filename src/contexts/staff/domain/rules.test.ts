// Staff context — domain rules tests
// Authorization checks have been moved to the centralized permission system.
// These tests verify the permission table entries for staff_assignment actions
// and the pure validation rules in domain/rules.ts.

import { describe, it, expect } from 'vitest'
import { can } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
import { validateNotSelfAssignment, validateRequiredId } from './rules'
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

describe('validateRequiredId', () => {
  it('returns ok for non-empty string', () => {
    const result = validateRequiredId('some-id', 'Test Field')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toBe('some-id')
    }
  })

  it('returns err for empty string', () => {
    const result = validateRequiredId('', 'Test Field')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_input')
      expect(result.error.message).toContain('Test Field')
    }
  })

  it('returns err for whitespace-only string', () => {
    const result = validateRequiredId('   ', 'User ID')
    expect(result.isErr()).toBe(true)
  })
})
