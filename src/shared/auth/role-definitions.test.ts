// Built-in role authority: the permission set and data scope of each Better Auth
// role token.

import { describe, it, expect } from 'vitest'
import { builtInPermissionsForRole, BUILT_IN_ROLE_SCOPE } from './role-definitions'
import { initPermissionTable } from './permissions'

// Ensure the permission table is initialized for builtInPermissionsForRole.
initPermissionTable()

describe('builtInPermissionsForRole', () => {
  it('returns the owner permission set for "owner"', () => {
    const perms = builtInPermissionsForRole('owner')
    expect(perms.has('organization.update')).toBe(true)
    expect(perms.has('member.create')).toBe(true)
  })

  it('gives a PropertyManager less than the owner and a staff login less again', () => {
    const owner = builtInPermissionsForRole('owner')
    const admin = builtInPermissionsForRole('admin')
    const member = builtInPermissionsForRole('member')
    expect(admin.size).toBeLessThan(owner.size)
    expect(member.size).toBeLessThan(admin.size)
    expect(admin.has('member.create')).toBe(false)
  })

  it.each(['content-manager', 'owner,admin', ' owner', ''])(
    'grants nothing to %j, which is not a built-in role token',
    (token) => {
      expect(builtInPermissionsForRole(token).size).toBe(0)
    },
  )
})

describe('BUILT_IN_ROLE_SCOPE', () => {
  it('gives the owner the organization and every other built-in role its assigned Properties', () => {
    expect(BUILT_IN_ROLE_SCOPE).toEqual({
      owner: 'organization',
      admin: 'assigned-properties',
      member: 'assigned-properties',
    })
  })
})
