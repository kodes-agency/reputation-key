import { describe, expect, it } from 'vitest'
import type { Permission } from '#/shared/domain/permissions'
import { portalAccessOf } from './use-portal-access'

const roleHolding =
  (...held: Permission[]) =>
  (permission: Permission) =>
    held.includes(permission)

const ADMIN = roleHolding(
  'portal.read',
  'portal.update',
  'portal.create',
  'portal.delete',
)

describe('portalAccessOf', () => {
  it('lets a role that may change portals do so while the capability is on', () => {
    expect(portalAccessOf(ADMIN, true)).toEqual({
      canEdit: true,
      canCreate: true,
      canArchive: true,
      changesOff: false,
    })
  })

  it('takes every change away while the capability is off, and says that is why', () => {
    expect(portalAccessOf(ADMIN, false)).toEqual({
      canEdit: false,
      canCreate: false,
      canArchive: false,
      changesOff: true,
    })
  })

  it('asks the role for each change on its own', () => {
    const editor = roleHolding('portal.read', 'portal.update')
    expect(portalAccessOf(editor, true)).toMatchObject({
      canEdit: true,
      canCreate: false,
      canArchive: false,
    })
  })

  it('says nothing about a role that could not change portals anyway', () => {
    const reader = roleHolding('portal.read')
    expect(portalAccessOf(reader, false)).toMatchObject({
      canEdit: false,
      changesOff: false,
    })
    expect(portalAccessOf(reader, true).changesOff).toBe(false)
  })
})
