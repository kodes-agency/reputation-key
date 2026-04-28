// Shared auth permissions — tests for permission definitions and table injection
// Verifies that the three default roles (owner/admin/member) have the correct
// permission sets and that the sync permission table is properly initialized.

import { describe, it, expect } from 'vitest'
import { statement } from './permissions'
import { can, setPermissionTable } from '#/shared/domain/permissions'
import type { Permission } from '#/shared/domain/permissions'

// Re-import the permissions module to trigger setPermissionTable()
// The module-level side effect already ran on first import, so we
// test against the initialized table.

describe('permissions statement', () => {
  it('defines all expected resources', () => {
    const resources = Object.keys(statement)
    expect(resources).toContain('organization')
    expect(resources).toContain('member')
    expect(resources).toContain('invitation')
    expect(resources).toContain('property')
    expect(resources).toContain('team')
    expect(resources).toContain('staff_assignment')
    expect(resources).toContain('ac')
    expect(resources).toContain('portal')
    expect(resources).toContain('review')
    expect(resources).toContain('feedback')
    expect(resources).toContain('integration')
  })

  it('defines expected actions for each resource', () => {
    expect(statement.organization).toContain('update')
    expect(statement.organization).toContain('delete')
    expect(statement.member).toContain('create')
    expect(statement.member).toContain('update')
    expect(statement.member).toContain('delete')
    expect(statement.invitation).toContain('create')
    expect(statement.invitation).toContain('cancel')
    expect(statement.property).toContain('create')
    expect(statement.property).toContain('update')
    expect(statement.property).toContain('delete')
    expect(statement.team).toContain('create')
    expect(statement.team).toContain('update')
    expect(statement.team).toContain('delete')
    expect(statement.staff_assignment).toContain('create')
    expect(statement.staff_assignment).toContain('delete')
    expect(statement.review).toContain('read')
    expect(statement.review).toContain('reply')
    expect(statement.feedback).toContain('read')
    expect(statement.feedback).toContain('respond')
    expect(statement.integration).toContain('manage')
  })
})

describe('owner role (AccountAdmin)', () => {
  const ownerPermissions: Permission[] = [
    'organization.update',
    'organization.delete',
    'member.create',
    'member.update',
    'member.delete',
    'invitation.create',
    'invitation.cancel',
    'property.create',
    'property.update',
    'property.delete',
    'team.create',
    'team.update',
    'team.delete',
    'staff_assignment.create',
    'staff_assignment.delete',
    'ac.create',
    'ac.read',
    'ac.update',
    'ac.delete',
    'portal.create',
    'portal.update',
    'portal.delete',
    'review.read',
    'review.reply',
    'feedback.read',
    'feedback.respond',
    'integration.manage',
  ]

  it('has every permission defined in the statement', () => {
    for (const permission of ownerPermissions) {
      expect(can('AccountAdmin', permission)).toBe(true)
    }
  })
})

describe('admin role (PropertyManager)', () => {
  const allowedPermissions: Permission[] = [
    'member.create',
    'invitation.create',
    'invitation.cancel',
    'property.create',
    'property.update',
    'team.create',
    'team.update',
    'staff_assignment.create',
    'staff_assignment.delete',
    'portal.create',
    'portal.update',
    'review.read',
    'review.reply',
    'feedback.read',
    'feedback.respond',
  ]

  const deniedPermissions: Permission[] = [
    'organization.update',
    'organization.delete',
    'member.update',
    'member.delete',
    'property.delete',
    'team.delete',
    'ac.create',
    'ac.read',
    'ac.update',
    'ac.delete',
    'portal.delete',
    'integration.manage',
  ]

  it('has all expected permissions', () => {
    for (const permission of allowedPermissions) {
      expect(can('PropertyManager', permission)).toBe(true)
    }
  })

  it('does not have permissions outside its scope', () => {
    for (const permission of deniedPermissions) {
      expect(can('PropertyManager', permission)).toBe(false)
    }
  })
})

describe('memberRole (Staff)', () => {
  it('can only read reviews', () => {
    expect(can('Staff', 'review.read')).toBe(true)
  })

  it('cannot manage members', () => {
    expect(can('Staff', 'member.create')).toBe(false)
    expect(can('Staff', 'member.update')).toBe(false)
    expect(can('Staff', 'member.delete')).toBe(false)
  })

  it('cannot manage properties', () => {
    expect(can('Staff', 'property.create')).toBe(false)
    expect(can('Staff', 'property.update')).toBe(false)
    expect(can('Staff', 'property.delete')).toBe(false)
  })

  it('cannot manage teams', () => {
    expect(can('Staff', 'team.create')).toBe(false)
    expect(can('Staff', 'team.update')).toBe(false)
    expect(can('Staff', 'team.delete')).toBe(false)
  })

  it('cannot manage staff assignments', () => {
    expect(can('Staff', 'staff_assignment.create')).toBe(false)
    expect(can('Staff', 'staff_assignment.delete')).toBe(false)
  })

  it('cannot manage organizations', () => {
    expect(can('Staff', 'organization.update')).toBe(false)
    expect(can('Staff', 'organization.delete')).toBe(false)
  })

  it('cannot manage invitations', () => {
    expect(can('Staff', 'invitation.create')).toBe(false)
    expect(can('Staff', 'invitation.cancel')).toBe(false)
  })
})

describe('setPermissionTable', () => {
  it('overwrites the permission table when called again', () => {
    // Arrange: set a restrictive table where no role has any permissions
    setPermissionTable({
      AccountAdmin: new Set(),
      PropertyManager: new Set(),
      Staff: new Set(),
    })

    // Act/Assert
    expect(can('AccountAdmin', 'member.create')).toBe(false)
    expect(can('PropertyManager', 'team.create')).toBe(false)
    expect(can('Staff', 'review.read')).toBe(false)

    // Restore the real permission table by re-importing the module side effect
    // We manually set it back to match the production configuration
    setPermissionTable({
      AccountAdmin: new Set([
        'organization.update',
        'organization.delete',
        'member.create',
        'member.update',
        'member.delete',
        'invitation.create',
        'invitation.cancel',
        'property.create',
        'property.update',
        'property.delete',
        'team.create',
        'team.update',
        'team.delete',
        'staff_assignment.create',
        'staff_assignment.delete',
        'ac.create',
        'ac.read',
        'ac.update',
        'ac.delete',
        'portal.create',
        'portal.update',
        'portal.delete',
        'review.read',
        'review.reply',
        'feedback.read',
        'feedback.respond',
        'integration.manage',
      ]),
      PropertyManager: new Set([
        'member.create',
        'invitation.create',
        'invitation.cancel',
        'property.create',
        'property.update',
        'team.create',
        'team.update',
        'staff_assignment.create',
        'staff_assignment.delete',
        'portal.create',
        'portal.update',
        'review.read',
        'review.reply',
        'feedback.read',
        'feedback.respond',
      ]),
      Staff: new Set(['review.read']),
    })

    expect(can('AccountAdmin', 'member.create')).toBe(true)
    expect(can('Staff', 'review.read')).toBe(true)
  })
})

describe('can() before table initialization', () => {
  it('returns false when permission table is null', () => {
    // Temporarily null out the table
    setPermissionTable(null as unknown as Parameters<typeof setPermissionTable>[0])

    expect(can('AccountAdmin', 'member.create')).toBe(false)

    // Restore
    setPermissionTable({
      AccountAdmin: new Set(['member.create']),
      PropertyManager: new Set(),
      Staff: new Set(),
    })
  })
})
