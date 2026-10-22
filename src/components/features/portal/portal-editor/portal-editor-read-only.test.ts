import { describe, expect, it } from 'vitest'
import { describeEditorReadOnly } from './portal-editor-read-only'

describe('describeEditorReadOnly', () => {
  it('says nothing while the portal can be edited', () => {
    expect(
      describeEditorReadOnly({ canEdit: true, changesOff: false, archived: false }),
    ).toBeNull()
  })

  it('names the role when it does not allow changing portals', () => {
    expect(
      describeEditorReadOnly({ canEdit: false, changesOff: false, archived: false }),
    ).toBe('You can look at this portal, but your role doesn’t allow changing it.')
  })

  it('says portal changes are off for the organization when that is the only thing in the way', () => {
    expect(
      describeEditorReadOnly({ canEdit: false, changesOff: true, archived: false }),
    ).toBe(
      'You can look at this portal, but changing portals isn’t available for your organization right now.',
    )
  })

  it('says an archived portal is kept as it was, and where it is restored', () => {
    expect(
      describeEditorReadOnly({ canEdit: true, changesOff: false, archived: true }),
    ).toBe(
      'You can look at this portal, but not change it while it is archived. Restore it from the Portals list to edit it.',
    )
  })

  it('does not send anyone to restore a portal they could not restore', () => {
    for (const changesOff of [false, true]) {
      expect(
        describeEditorReadOnly({ canEdit: false, changesOff, archived: true }),
      ).not.toMatch(/Restore/)
    }
  })
})
