import { describe, expect, it } from 'vitest'
import {
  groupMenu,
  groupPageControls,
  type GroupMenuAccess,
} from './portal-group-menu-rules'

const everything: GroupMenuAccess = {
  canRename: true,
  canArchive: true,
  portalWriteEnabled: true,
  canSetGoal: true,
}

const ids = (access: GroupMenuAccess, where: 'overview' | 'page') =>
  groupMenu(access, where).map((entry) => entry.id)

describe('groupMenu', () => {
  it('offers the whole menu in the overview, archive last and marked destructive', () => {
    const menu = groupMenu(everything, 'overview')

    expect(menu.map((entry) => entry.id)).toEqual(['open', 'rename', 'goal', 'archive'])
    expect(menu.at(-1)?.destructive).toBe(true)
    expect(menu.slice(0, -1).every((entry) => !entry.destructive)).toBe(true)
  })

  it('leaves "Open group" and "Rename" out on the group page, which has its own Rename button', () => {
    expect(ids(everything, 'page')).toEqual(['goal', 'archive'])
  })

  it('offers nothing that writes while the organisation has portal writes off', () => {
    expect(ids({ ...everything, portalWriteEnabled: false }, 'overview')).toEqual([
      'open',
      'goal',
    ])
  })

  it('keeps rename and archive off a role that may not update or delete', () => {
    expect(ids({ ...everything, canRename: false }, 'overview')).toEqual([
      'open',
      'goal',
      'archive',
    ])
    expect(ids({ ...everything, canArchive: false }, 'overview')).toEqual([
      'open',
      'rename',
      'goal',
    ])
  })

  it('keeps "Set a goal" off where goals cannot be created', () => {
    expect(ids({ ...everything, canSetGoal: false }, 'page')).toEqual(['archive'])
  })

  it('has no menu at all for a viewer on the group page', () => {
    expect(
      ids(
        {
          canRename: false,
          canArchive: false,
          portalWriteEnabled: true,
          canSetGoal: false,
        },
        'page',
      ),
    ).toEqual([])
  })
})

describe('groupPageControls', () => {
  it('lets a reader who may update, with writes on, change the group in place', () => {
    expect(groupPageControls(everything)).toEqual({ canEdit: true })
  })

  it.each([
    ['may not update', { ...everything, canRename: false }],
    ['has portal writes off', { ...everything, portalWriteEnabled: false }],
  ])('keeps a reader who %s from changing it', (_label, access) => {
    expect(groupPageControls(access)).toEqual({ canEdit: false })
  })
})
