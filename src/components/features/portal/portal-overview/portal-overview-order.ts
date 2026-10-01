// How the Portals overview orders what it lists: Portals inside a group, and
// the groups themselves. Pure, and generic over what it orders so the view that
// builds the page and this ordering do not depend on each other.
//
// Archived Portals follow the others in either direction, and a Portal with no
// figure to sort by (still processing, a draft, or no results yet) follows those
// with one: there is nothing to say it belongs at either end.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { attentionRank, type PortalAttention } from './portal-attention'
import type {
  OrganizationSortFigures,
  OverviewSortFigures,
} from './portal-overview-results'
import type { PortalOverviewSort, SortDirection } from './portal-overview-search-schema'

export type Orderable = Readonly<{
  row: Pick<PortalOverviewRow, 'portalId' | 'name' | 'slug' | 'publicationState'>
  attention: PortalAttention
}>

export type OrderableBucket<T extends Orderable> = Readonly<{
  kind: 'group' | 'ungrouped'
  group: Readonly<{ id: string; name: string }> | null
  items: readonly T[]
}>

const compareText = (a: string, b: string): number =>
  a.toLowerCase().localeCompare(b.toLowerCase())

const applyDirection = (order: number, dir: SortDirection): number =>
  dir === 'asc' ? order : -order

const isArchived = (item: Orderable): boolean => item.row.publicationState === 'archived'

/** Orders two figures, most first when `dir` is 'desc'; no figure follows a figure. */
function compareFigures(a: number | null, b: number | null, dir: SortDirection): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return applyDirection(a - b, dir)
}

export function compareItems<T extends Orderable>(
  sort: PortalOverviewSort,
  dir: SortDirection,
  figures: OverviewSortFigures | undefined,
): (a: T, b: T) => number {
  return (a, b) => {
    // Archived Portals are finished, so they follow the others in either order.
    if (isArchived(a) !== isArchived(b)) return isArchived(a) ? 1 : -1
    const byName = applyDirection(compareText(a.row.name, b.row.name), dir)
    if (sort === 'name') return byName || compareText(a.row.slug, b.row.slug)
    if (sort === 'scans') {
      const byScans = compareFigures(
        figures?.portal(a.row.portalId) ?? null,
        figures?.portal(b.row.portalId) ?? null,
        dir,
      )
      return byScans || compareText(a.row.name, b.row.name)
    }
    const byAttention = applyDirection(
      attentionRank(a.attention) - attentionRank(b.attention),
      dir,
    )
    return byAttention || compareText(a.row.name, b.row.name)
  }
}

/** Groups follow the sort; Portals in no group always come last. */
export function orderGroups<T extends Orderable, B extends OrderableBucket<T>>(
  buckets: readonly B[],
  sort: PortalOverviewSort,
  dir: SortDirection,
  figures: OverviewSortFigures | undefined,
): readonly B[] {
  const pressing = (bucket: B): number =>
    Math.max(...bucket.items.map((item) => attentionRank(item.attention)))
  const groups = buckets
    .filter((bucket) => bucket.kind === 'group')
    .sort((a, b) => {
      const byName = compareText(a.group?.name ?? '', b.group?.name ?? '')
      if (sort === 'name') return applyDirection(byName, dir) || 0
      if (sort === 'scans') {
        const byScans = compareFigures(
          a.group ? (figures?.group(a.group.id) ?? null) : null,
          b.group ? (figures?.group(b.group.id) ?? null) : null,
          dir,
        )
        return byScans || byName
      }
      return applyDirection(pressing(a) - pressing(b), dir) || byName
    })
  return [...groups, ...buckets.filter((bucket) => bucket.kind === 'ungrouped')]
}

export type OrderableProperty = Readonly<{
  propertyId: string
  name: string
  /** The most pressing attention among the Portals the search keeps. */
  pressing: number
}>

/** Properties follow the sort too: by name, by their own scans, or by what presses most. */
export function compareProperties(
  sort: PortalOverviewSort,
  dir: SortDirection,
  figures: OrganizationSortFigures | undefined,
): (a: OrderableProperty, b: OrderableProperty) => number {
  return (a, b) => {
    const byName = compareText(a.name, b.name)
    if (sort === 'name')
      return applyDirection(byName, dir) || a.propertyId.localeCompare(b.propertyId)
    if (sort === 'scans') {
      const byScans = compareFigures(
        figures?.property(a.propertyId) ?? null,
        figures?.property(b.propertyId) ?? null,
        dir,
      )
      return byScans || byName
    }
    return applyDirection(a.pressing - b.pressing, dir) || byName
  }
}
