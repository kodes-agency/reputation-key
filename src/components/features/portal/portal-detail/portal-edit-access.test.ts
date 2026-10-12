import { describe, expect, it } from 'vitest'
import { canRestorePortal, portalEditAccess } from './portal-edit-access'

const access = (over: Partial<Parameters<typeof portalEditAccess>[0]> = {}) =>
  portalEditAccess({
    canUpdate: true,
    portalWriteEnabled: true,
    publicationState: 'published',
    ...over,
  })

describe('portalEditAccess — one answer for every surface that edits', () => {
  it.each(['draft', 'published', 'disabled'] as const)(
    'lets a manager with the role and the capability edit a %s portal',
    (publicationState) => {
      expect(access({ publicationState })).toEqual({
        canEdit: true,
        readOnlyReason: null,
      })
    },
  )

  it('says the role is why, when the role cannot update portals', () => {
    expect(access({ canUpdate: false })).toEqual({
      canEdit: false,
      readOnlyReason: 'role',
    })
  })

  // The server refuses every portal write while the capability is off, so the
  // editor must not look usable then.
  it('says the account is why, when portal writes are switched off', () => {
    expect(access({ portalWriteEnabled: false })).toEqual({
      canEdit: false,
      readOnlyReason: 'capability',
    })
  })

  it('says the portal is archived before anything about the person', () => {
    expect(access({ publicationState: 'archived', canUpdate: false })).toEqual({
      canEdit: false,
      readOnlyReason: 'archived',
    })
  })
})

describe('canRestorePortal', () => {
  it('needs both the role and the capability, as any portal write does', () => {
    expect(canRestorePortal({ canUpdate: true, portalWriteEnabled: true })).toBe(true)
    expect(canRestorePortal({ canUpdate: false, portalWriteEnabled: true })).toBe(false)
    expect(canRestorePortal({ canUpdate: true, portalWriteEnabled: false })).toBe(false)
  })
})
