import type { SectionNavItem } from './section-nav-types'

export type SectionNavGroup = Readonly<{
  /** Stable across renders: the heading, or `ungrouped`, plus the group's position. */
  key: string
  /** The group's name, or null for items that name none. */
  heading: string | null
  items: ReadonlyArray<SectionNavItem>
}>

/**
 * The items as groups, in item order: a new group starts whenever `group` changes,
 * so a group is a run of neighbours, not a bucket that reorders the list.
 */
export function groupSectionNavItems(
  items: ReadonlyArray<SectionNavItem>,
): ReadonlyArray<SectionNavGroup> {
  return items.reduce<ReadonlyArray<SectionNavGroup>>((groups, item) => {
    const heading = item.group ?? null
    const last = groups.at(-1)
    if (last !== undefined && last.heading === heading) {
      return [...groups.slice(0, -1), { ...last, items: [...last.items, item] }]
    }
    return [
      ...groups,
      { key: `${heading ?? 'ungrouped'}:${groups.length}`, heading, items: [item] },
    ]
  }, [])
}
