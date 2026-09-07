// Shared auth permissions — tests for permission definitions and table initialization
// Verifies that the three default roles (owner/admin/member) have the correct
// permission sets and that the sync permission table is properly initialized.

import { describe, it, expect } from 'vitest'
import { statement, can, initPermissionTable } from './permissions'
import type { Permission } from '#/shared/domain/permissions'

describe('permissions statement', () => {
  it('defines all expected resources', () => {
    const resources = Object.keys(statement)
    expect(resources).toContain('organization')
    expect(resources).toContain('member')
    expect(resources).toContain('invitation')
    expect(resources).toContain('property')
    expect(resources).toContain('staff')
    expect(resources).toContain('ac')
    expect(resources).toContain('portal')
    expect(resources).toContain('review')
    expect(resources).toContain('feedback')
    expect(resources).toContain('integration')
    expect(resources).toContain('inbox')
    expect(resources).toContain('goal')
    expect(resources).toContain('ai')
  })

  it('defines expected actions for each resource', () => {
    expect(statement.organization).toContain('update')
    expect(statement.organization).toContain('delete')
    expect(statement.member).toContain('create')
    expect(statement.member).toContain('update')
    expect(statement.member).toContain('delete')
    expect(statement.invitation).toContain('create')
    expect(statement.invitation).toContain('list')
    expect(statement.invitation).toContain('cancel')
    expect(statement.property).toContain('create')
    expect(statement.property).toContain('update')
    expect(statement.property).toContain('delete')
    expect(statement.staff).toContain('manage')
    expect(statement.staff).toContain('read')
    expect(statement.portal).toContain('admin')
    expect(statement.review).toContain('read')
    expect(statement.feedback).toContain('read')
    expect(statement.feedback).toContain('respond')
    expect(statement.feedback).toContain('contact_read')
    expect(statement.integration).toContain('manage')
    expect(statement.property).toContain('import_gbp_v2')
    expect(statement.property).toContain('read_gbp_performance')
    expect(statement.inbox).toContain('read')
    expect(statement.inbox).toContain('write')
    expect(statement.inbox).toContain('manage')
    expect(statement.goal).toContain('read')
    expect(statement.goal).toContain('create')
    expect(statement.goal).toContain('update')
    expect(statement.goal).toContain('cancel')
    expect(statement.ai).toEqual(['reply.generate', 'trends.read', 'manage'])
  })
})

describe('owner role (AccountAdmin)', () => {
  const ownerPermissions: Permission[] = [
    'organization.update',
    'organization.delete',
    'member.create',
    'member.list',
    'member.update',
    'member.delete',
    'invitation.create',
    'invitation.list',
    'invitation.cancel',
    'invitation.resend',
    'property.create',
    'property.update',
    'property.delete',
    'property.read',
    'property.admin',
    'property.import_gbp_v2',
    'property.read_gbp_performance',
    'staff.manage',
    'staff.read',
    'ac.create',
    'ac.read',
    'ac.update',
    'ac.delete',
    'portal.create',
    'portal.admin',
    'portal.update',
    'portal.delete',
    'portal.read',
    'review.read',
    'reply.manage',
    'feedback.read',
    'feedback.handle',
    'feedback.respond',
    'feedback.contact_read',
    'inbox.read',
    'inbox.write',
    'inbox.manage',
    'integration.manage',
    'ai.reply.generate',
    'ai.trends.read',
    'ai.manage',
    'dashboard.read',
    'dashboard.fleet_read',
    'goal.read',
    'goal.create',
    'goal.update',
    'goal.cancel',
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
    'member.list',
    'invitation.create',
    'invitation.list',
    'invitation.cancel',
    'invitation.resend',
    'property.create',
    'property.update',
    'property.read',
    'property.admin',
    'property.read_gbp_performance',
    'staff.manage',
    'staff.read',
    'portal.create',
    'portal.update',
    'portal.read',
    'review.read',
    'reply.manage',
    'feedback.read',
    'feedback.handle',
    'feedback.respond',
    'feedback.contact_read',
    'inbox.read',
    'inbox.write',
    'inbox.manage',
    'organization.update',
    'ai.reply.generate',
    'ai.trends.read',
    'ai.manage',
    'dashboard.read',
    'dashboard.fleet_read',
    'goal.read',
    'goal.create',
    'goal.update',
    'goal.cancel',
  ]

  const deniedPermissions: Permission[] = [
    'organization.delete',
    'member.update',
    'member.delete',
    'property.delete',
    'ac.create',
    'ac.read',
    'ac.update',
    'ac.delete',
    'portal.delete',
    'portal.admin',
    'property.import_gbp_v2',
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

describe('memberRole (Member)', () => {
  it('can only read reviews', () => {
    expect(can('Member', 'review.read')).toBe(true)
  })

  it('does not expose manager-facing Goal metrics before a Member dashboard exists', () => {
    expect(can('Member', 'goal.read')).toBe(false)
  })

  it('cannot create goals', () => {
    expect(can('Member', 'goal.create')).toBe(false)
  })

  it('cannot update goals', () => {
    expect(can('Member', 'goal.update')).toBe(false)
  })

  it('cannot cancel goals', () => {
    expect(can('Member', 'goal.cancel')).toBe(false)
  })

  it('cannot manage members', () => {
    expect(can('Member', 'member.create')).toBe(false)
    expect(can('Member', 'member.update')).toBe(false)
    expect(can('Member', 'member.delete')).toBe(false)
  })

  it('cannot manage properties', () => {
    expect(can('Member', 'property.create')).toBe(false)
    expect(can('Member', 'property.update')).toBe(false)
    expect(can('Member', 'property.delete')).toBe(false)
  })

  it('cannot read live GBP Performance or import properties', () => {
    expect(can('Member', 'property.read_gbp_performance')).toBe(false)
    expect(can('Member', 'property.import_gbp_v2')).toBe(false)
  })

  it('cannot manage staff participation lifecycle', () => {
    expect(can('Member', 'staff.manage')).toBe(false)
    expect(can('Member', 'staff.read')).toBe(true)
  })

  it('cannot manage organizations', () => {
    expect(can('Member', 'organization.update')).toBe(false)
    expect(can('Member', 'organization.delete')).toBe(false)
  })

  it('cannot manage invitations', () => {
    expect(can('Member', 'invitation.create')).toBe(false)
    expect(can('Member', 'invitation.list')).toBe(false)
    expect(can('Member', 'invitation.cancel')).toBe(false)
  })

  it('is denied manager-only surface permissions', () => {
    expect(can('Member', 'dashboard.fleet_read')).toBe(false)
    expect(can('Member', 'property.admin')).toBe(false)
    expect(can('Member', 'inbox.manage')).toBe(false)
    expect(can('Member', 'feedback.handle')).toBe(false)
    expect(can('Member', 'ai.reply.generate')).toBe(false)
    expect(can('Member', 'ai.trends.read')).toBe(false)
    expect(can('Member', 'ai.manage')).toBe(false)
  })

  it('grants private-feedback handling to manager roles', () => {
    expect(can('AccountAdmin', 'feedback.handle')).toBe(true)
    expect(can('PropertyManager', 'feedback.handle')).toBe(true)
  })
})

describe('initPermissionTable', () => {
  it('resets the permission table to the default configuration', () => {
    initPermissionTable()
    expect(can('AccountAdmin', 'member.create')).toBe(true)
    expect(can('Member', 'review.read')).toBe(true)
  })
})

describe('re-initializing permission table restores defaults', () => {
  it('throws when permission table is null', () => {
    initPermissionTable()
    expect(can('AccountAdmin', 'member.create')).toBe(true)
  })
})
