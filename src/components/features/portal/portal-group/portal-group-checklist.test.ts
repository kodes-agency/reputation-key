import { describe, expect, it } from 'vitest'
import { overviewGroup, overviewRow } from '../portal-overview/portal-overview-fixtures'
import {
  buildPortalChecklist,
  describeNewGroupSelection,
  describeSelection,
  toggleSelection,
} from './portal-group-checklist'

const wellness = overviewGroup('wellness', 'Wellness')
const frontOfHouse = overviewGroup('front', 'Front of house')

const rows = [
  overviewRow('olive', { name: 'Olive Terrace restaurant' }),
  overviewRow('pool', { name: 'Pool & Terrace' }),
  overviewRow('bar', { name: 'Pool bar', publicationState: 'draft' }),
  overviewRow('spa', { name: 'Spa & thermal pools', group: wellness }),
  overviewRow('reception', { name: 'Reception', group: frontOfHouse }),
  overviewRow('rooms', { name: 'Guest rooms', group: frontOfHouse }),
  overviewRow('old', { name: 'Old gazebo', publicationState: 'archived' }),
]

describe('buildPortalChecklist', () => {
  it('lists portals by where they are now, "Not in a group" first', () => {
    const sections = buildPortalChecklist(rows)

    expect(
      sections.map((section) => [section.label, section.portals.map((p) => p.name)]),
    ).toEqual([
      [
        'Not in a group',
        ['Old gazebo', 'Olive Terrace restaurant', 'Pool & Terrace', 'Pool bar'],
      ],
      ['In Front of house', ['Guest rooms', 'Reception']],
      ['In Wellness', ['Spa & thermal pools']],
    ])
  })

  it('says which portals are drafts or archived, and nothing else about them', () => {
    const flat = buildPortalChecklist(rows).flatMap((section) => section.portals)

    expect(flat.find((p) => p.id === 'bar')?.fact).toBe('Draft')
    expect(flat.find((p) => p.id === 'old')?.fact).toBe('Archived')
    expect(flat.find((p) => p.id === 'pool')?.fact).toBeNull()
  })

  it('names the group a portal would move from, so the dialog can say its results stay', () => {
    const flat = buildPortalChecklist(rows).flatMap((section) => section.portals)

    expect(flat.find((p) => p.id === 'spa')?.movesFrom).toBe('Wellness')
    expect(flat.find((p) => p.id === 'pool')?.movesFrom).toBeNull()
  })

  it('leaves out the portals already in the group being added to, and drops empty sections', () => {
    const sections = buildPortalChecklist(rows, { addingToGroupId: 'front' })

    expect(sections.map((section) => section.label)).toEqual([
      'Not in a group',
      'In Wellness',
    ])
  })

  it('drops a section that has nothing to choose', () => {
    const only = rows.filter((row) => row.group?.id === 'front')

    expect(buildPortalChecklist(only, { addingToGroupId: 'front' })).toEqual([])
  })
})

describe('toggleSelection', () => {
  it('adds a portal, and removes it again, without changing the list it was given', () => {
    const start = ['a'] as const

    const added = toggleSelection(start, 'b', true)
    const removed = toggleSelection(added, 'a', false)

    expect(added).toEqual(['a', 'b'])
    expect(removed).toEqual(['b'])
    expect(start).toEqual(['a'])
  })

  it('never lists a portal twice', () => {
    expect(toggleSelection(['a'], 'a', true)).toEqual(['a'])
  })
})

describe('describeSelection', () => {
  it.each([
    [0, 'No portals selected'],
    [1, '1 portal selected'],
    [3, '3 portals selected'],
  ])('says %i selected', (count, words) => {
    expect(describeSelection(count)).toBe(words)
  })
})

describe('describeNewGroupSelection', () => {
  it('does not read as a blocker: a group needs only a name, so no portals is fine', () => {
    expect(describeNewGroupSelection(0)).toBe(
      'Portals are optional. You can add them later.',
    )
  })

  it('counts what was ticked', () => {
    expect(describeNewGroupSelection(1)).toBe('1 portal selected')
    expect(describeNewGroupSelection(3)).toBe('3 portals selected')
  })
})
