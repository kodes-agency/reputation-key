import { describe, expect, it } from 'vitest'
import { portalEditAccess } from './portal-edit-access'

const MAY_EDIT = { canEdit: true, changesOff: false }
const ROLE_ONLY_READS = { canEdit: false, changesOff: false }
const CHANGES_OFF = { canEdit: false, changesOff: true }

describe('portalEditAccess — one answer for every surface that edits', () => {
  it.each(['draft', 'published', 'disabled'] as const)(
    'lets someone who may change portals edit a %s portal',
    (publicationState) => {
      expect(portalEditAccess(MAY_EDIT, publicationState)).toEqual({
        canEdit: true,
        readOnlyReason: null,
        canRestore: false,
      })
    },
  )

  it('says the role is why, when the role cannot update portals', () => {
    expect(portalEditAccess(ROLE_ONLY_READS, 'published')).toMatchObject({
      canEdit: false,
      readOnlyReason: 'role',
    })
  })

  // The server refuses every portal write while the capability is off, so the
  // editor must not look usable then.
  it('says changes are off for the organization when that is the only thing in the way', () => {
    expect(portalEditAccess(CHANGES_OFF, 'published')).toMatchObject({
      canEdit: false,
      readOnlyReason: 'capability',
    })
  })

  it('keeps an archived portal read-only even for someone who may change portals, and offers Restore', () => {
    expect(portalEditAccess(MAY_EDIT, 'archived')).toEqual({
      canEdit: false,
      readOnlyReason: 'archived',
      canRestore: true,
    })
  })

  it('does not offer a restore to someone who could not make it', () => {
    for (const access of [ROLE_ONLY_READS, CHANGES_OFF]) {
      const result = portalEditAccess(access, 'archived')
      expect(result.canRestore).toBe(false)
      expect(result.readOnlyReason).not.toBe('archived')
    }
  })
})
