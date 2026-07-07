// Role-definition mapping tests (ADR 0001 Stage 2). Pure mapping + the built-in
// permission provider; the DB fetch is a thin wrapper covered by integration tests.

import { describe, it, expect } from 'vitest'
import { builtInPermissionsForRole, mapRoleDefinitions } from './role-definitions'
import { initPermissionTable } from './permissions'

// Ensure the permission table is initialized for builtInPermissionsForRole.
initPermissionTable()

describe('mapRoleDefinitions', () => {
  it('canonicalizes role names (trim + lower-case) and parses permission statements', () => {
    const { customRoles } = mapRoleDefinitions(
      [
        {
          role: 'Content-Manager ',
          permission: JSON.stringify({ portal: ['read', 'update'] }),
        },
      ],
      [],
    )

    expect(customRoles).toHaveLength(1)
    expect(customRoles[0].role).toBe('content-manager')
    expect(customRoles[0].permissions).toEqual(['portal.read', 'portal.update'])
  })

  it('drops unknown permissions and treats null/invalid JSON as no permissions', () => {
    const { customRoles } = mapRoleDefinitions(
      [
        { role: 'r1', permission: JSON.stringify({ bogus: ['read'] }) },
        { role: 'r2', permission: null },
        { role: 'r3', permission: 'not json' },
      ],
      [],
    )

    expect(customRoles[0].permissions).toEqual([])
    expect(customRoles[1].permissions).toEqual([])
    expect(customRoles[2].permissions).toEqual([])
  })

  it('maps policy data_scope, falling back to none for invalid values', () => {
    const { policies } = mapRoleDefinitions(
      [],
      [
        { role: ' Role-A ', dataScope: 'organization' },
        { role: 'role-b', dataScope: 'assigned-properties' },
        { role: 'role-c', dataScope: 'bogus' },
      ],
    )

    expect(policies.map((p) => [p.role, p.dataScope])).toEqual([
      ['role-a', 'organization'],
      ['role-b', 'assigned-properties'],
      ['role-c', 'none'],
    ])
  })
})

describe('builtInPermissionsForRole', () => {
  it('returns the owner permission set for "owner"', () => {
    const perms = builtInPermissionsForRole('owner')
    expect(perms.has('organization.update')).toBe(true)
    expect(perms.has('member.create')).toBe(true)
  })

  it('returns an empty set for an unknown (custom) role name', () => {
    expect(builtInPermissionsForRole('content-manager').size).toBe(0)
  })
})
