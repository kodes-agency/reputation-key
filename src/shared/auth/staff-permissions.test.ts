import { describe, expect, it } from 'vitest'
import { memberRole, can } from './permissions'
import { capabilityForPermission } from './capability-for-permission'
import { builtInPermissionsForRole } from './role-definitions'

describe('staff account permissions', () => {
  it('keeps the Member role to self service only', () => {
    expect(memberRole.statements).toEqual({
      staff: ['self'],
      identity: ['avatar_upload', 'password.change', 'profile.update', 'avatar.set'],
    })
    expect(builtInPermissionsForRole('member').has('dashboard.read')).toBe(false)
  })

  it('allows managers to invite and remove staff, with settings reserved for owners', () => {
    for (const role of ['AccountAdmin', 'PropertyManager', 'Member'] as const) {
      expect(can(role, 'staff.self')).toBe(true)
      expect(can(role, 'staff.invite')).toBe(role !== 'Member')
      expect(can(role, 'staff.remove')).toBe(role !== 'Member')
      expect(can(role, 'staff.settings')).toBe(role === 'AccountAdmin')
    }
    for (const permission of [
      'staff.self',
      'staff.invite',
      'staff.remove',
      'staff.settings',
    ] as const) {
      expect(capabilityForPermission(permission)).toBe('staff.accounts')
    }
  })
})
