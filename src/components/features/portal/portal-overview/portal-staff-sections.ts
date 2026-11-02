import type { PortalOverviewItem, PortalOverviewSection } from './portal-overview-view'
export type OverviewBucket = Readonly<{
  kind: 'group' | 'ungrouped' | 'staff'
  key: string
  group: PortalOverviewSection['group']
  memberCount: number
  items: readonly PortalOverviewItem[]
  staff?: Readonly<{ count: number; places: number; names: readonly string[] }>
  searchExpanded?: boolean
}>

export function overviewBuckets(
  all: readonly PortalOverviewItem[],
  matched: readonly PortalOverviewItem[],
  grouping: boolean,
  searching: boolean,
): readonly OverviewBucket[] {
  const key = (item: PortalOverviewItem) =>
    !grouping
      ? item.row.kind === 'personal'
        ? 'staff'
        : 'flat'
      : (item.row.group?.id ??
        (item.row.kind === 'personal' ? 'other-staff' : 'ungrouped'))
  const keys = [...new Set(matched.map(key))]
  return keys.map((id) => {
    const items = matched.filter((item) => key(item) === id)
    const members = all.filter((item) => key(item) === id)
    const people = members.filter((item) => item.row.kind === 'personal')
    const group = grouping ? (items[0]?.row.group ?? null) : null
    return {
      kind:
        id === 'staff' || id === 'other-staff'
          ? ('staff' as const)
          : id === 'ungrouped'
            ? ('ungrouped' as const)
            : ('group' as const),
      key: id,
      group,
      memberCount: members.length,
      items,
      ...(people.length
        ? {
            staff: {
              count: people.length,
              places: members.length - people.length,
              names: people
                .map((item) => item.row.name)
                .sort((a, b) => a.localeCompare(b)),
            },
            searchExpanded: searching,
          }
        : {}),
    }
  })
}
export function sectionExpanded(
  section: Pick<PortalOverviewSection, 'kind' | 'staff' | 'searchExpanded'>,
  folded: boolean | undefined,
): boolean {
  if (section.searchExpanded || section.kind === 'flat') return true
  return folded === undefined ? !section.staff : !folded
}
export function staffSectionCount(
  staff: NonNullable<PortalOverviewSection['staff']>,
): string {
  const people = `${staff.count} ${staff.count === 1 ? 'person' : 'people'}`
  return staff.places
    ? `${staff.places} ${staff.places === 1 ? 'portal' : 'portals'} · ${people}`
    : people
}

export function overviewSectionName(
  section: Pick<PortalOverviewSection, 'group' | 'kind' | 'key'>,
): string {
  if (section.group) return section.group.name
  if (section.kind !== 'staff') return 'Not in a group'
  return section.key === 'staff' ? 'Staff' : 'Other staff'
}
export function staffGrouping(
  rows: readonly Readonly<{ kind: string }>[],
): 'group' | 'none' {
  return rows.some((row) => row.kind === 'personal') ? 'group' : 'none'
}
