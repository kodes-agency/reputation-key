import { describe, expect, it } from 'vitest'
import { groupSectionNavItems } from './section-nav-groups'

const item = (key: string, group?: string) => ({
  key,
  to: `/${key}`,
  label: key,
  ...(group === undefined ? {} : { group }),
})

describe('groupSectionNavItems', () => {
  it('is one headless group when no item names a group', () => {
    const groups = groupSectionNavItems([item('a'), item('b')])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.heading).toBeNull()
    expect(groups[0]?.items.map((entry) => entry.key)).toEqual(['a', 'b'])
  })

  it('starts a group whenever the group changes, keeping item order', () => {
    const groups = groupSectionNavItems([
      item('a', 'On the page'),
      item('b', 'On the page'),
      item('c', 'Behind the page'),
    ])

    expect(groups.map((group) => group.heading)).toEqual([
      'On the page',
      'Behind the page',
    ])
    expect(groups.map((group) => group.items.map((entry) => entry.key))).toEqual([
      ['a', 'b'],
      ['c'],
    ])
  })

  it('separates items without a group from those after them that have one', () => {
    const groups = groupSectionNavItems([item('a'), item('b'), item('z', 'danger')])

    expect(groups.map((group) => group.items.map((entry) => entry.key))).toEqual([
      ['a', 'b'],
      ['z'],
    ])
    expect(groups.map((group) => group.heading)).toEqual([null, 'danger'])
  })

  it('gives each group a key that is stable across renders', () => {
    const first = groupSectionNavItems([item('a', 'One'), item('b', 'Two')])
    const second = groupSectionNavItems([item('a', 'One'), item('b', 'Two')])

    expect(first.map((group) => group.key)).toEqual(second.map((group) => group.key))
    expect(new Set(first.map((group) => group.key)).size).toBe(2)
  })

  it('is empty for no items', () => {
    expect(groupSectionNavItems([])).toEqual([])
  })
})
