// The All properties page as data: every Portal the reader may see, under the
// Property it belongs to, which Properties come first, and which page is open.
// Pure, so search, order and paging across Properties are tested without a
// table; the page draws what this decides.
//
// Each Property is built by the same rules as the Portals page of one Property
// (`buildPortalOverview`): its Portals in order, in their groups when it has
// groups. This module adds what only the Organization needs: Property names
// (search matches them too), the order of the Properties, and one page count
// across all of them.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { attentionRank } from './portal-attention'
import { compareProperties } from './portal-overview-order'
import type { OrganizationSortFigures } from './portal-overview-results'
import {
  DEFAULT_PORTAL_OVERVIEW_SORT,
  defaultSortDirection,
  type PortalOverviewSearch,
} from './portal-overview-search-schema'
import {
  PORTAL_OVERVIEW_PAGE_SIZE,
  buildPortalOverview,
  type PortalManagerName,
  type PortalOverviewItem,
  type PortalOverviewSection,
} from './portal-overview-view'

/** What the All properties page reads of the URL: the search, the order, the page. */
export type AllPropertiesSearch = Pick<
  PortalOverviewSearch,
  'q' | 'sort' | 'dir' | 'page'
>

export type PortalPropertyInfo = Readonly<{
  id: string
  name: string
  googleBindingState?:
    'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
}>

export type PortalPropertySection = Readonly<{
  propertyId: string
  name: string
  /** What is wrong with the Property's Google link, if anything; linked says nothing. */
  googleNotice: string | null
  /** Every Portal in the Property, whatever the search left. */
  memberCount: number
  /** The Portals of the Property the search keeps, on every page. */
  matchedCount: number
  /** The Property's groups (or one flat list) with the Portals on this page. */
  sections: readonly PortalOverviewSection[]
}>

export type AllPropertiesPage = Readonly<{
  properties: readonly PortalPropertySection[]
  /** The Properties that hold Portals, before the search. */
  propertyCount: number
  /** Every Portal, before the search. */
  total: number
  /** The Portals the search keeps, on every page. */
  matched: number
  page: number
  lastPage: number
  /** 1-based position of the first and last Portal on this page; 0 when none. */
  from: number
  to: number
}>

const UNKNOWN_PROPERTY = 'Another property'
const GOOGLE_RECONNECT = 'Google link needs reconnecting'

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

function googleNoticeOf(info: PortalPropertyInfo | undefined): string | null {
  return info?.googleBindingState === 'disconnected' ? GOOGLE_RECONNECT : null
}

function rowsByProperty(
  rows: readonly PortalOverviewRow[],
): ReadonlyMap<string, readonly PortalOverviewRow[]> {
  const byProperty = new Map<string, PortalOverviewRow[]>()
  for (const row of rows) {
    byProperty.set(row.propertyId, [...(byProperty.get(row.propertyId) ?? []), row])
  }
  return byProperty
}

const itemsOf = (sections: readonly PortalOverviewSection[]): PortalOverviewItem[] =>
  sections.flatMap((section) => [...section.items])

export function buildAllPropertiesOverview(
  rows: readonly PortalOverviewRow[],
  properties: readonly PortalPropertyInfo[],
  search: AllPropertiesSearch,
  members: readonly PortalManagerName[],
  pageSize: number = PORTAL_OVERVIEW_PAGE_SIZE,
  /** What the results say each row counted, for the scans sort; none until they arrive. */
  figures?: OrganizationSortFigures,
): AllPropertiesPage {
  const sort = search.sort ?? DEFAULT_PORTAL_OVERVIEW_SORT
  const dir = search.dir ?? defaultSortDirection(sort)
  const needle = search.q?.trim().toLowerCase() ?? ''
  const infoById = new Map(properties.map((info) => [info.id, info]))
  const byProperty = rowsByProperty(rows)

  const built = [...byProperty].flatMap(([propertyId, propertyRows]) => {
    const info = infoById.get(propertyId)
    const name = info?.name ?? UNKNOWN_PROPERTY
    // Naming a Property asks for all of it; any other search narrows its Portals.
    const nameMatches = needle !== '' && name.toLowerCase().includes(needle)
    const inner = buildPortalOverview(
      propertyRows,
      {
        sort,
        dir,
        ...(nameMatches ? {} : { q: search.q }),
        groupBy: propertyRows.some((row) => row.group) ? 'group' : 'none',
      },
      members,
      propertyRows.length,
      figures,
    )
    if (inner.matched === 0) return []
    return [
      {
        propertyId,
        name,
        googleNotice: googleNoticeOf(info),
        memberCount: propertyRows.length,
        matchedCount: inner.matched,
        sections: inner.sections,
        pressing: Math.max(
          ...itemsOf(inner.sections).map((i) => attentionRank(i.attention)),
        ),
      },
    ]
  })

  const ordered = [...built].sort(compareProperties(sort, dir, figures))
  const everyItem = ordered.flatMap((property) => itemsOf(property.sections))
  const lastPage = Math.max(1, Math.ceil(everyItem.length / pageSize))
  const page = clamp(search.page ?? 1, 1, lastPage)
  const start = (page - 1) * pageSize
  const onPage = new Set(everyItem.slice(start, start + pageSize))

  const shown = ordered.flatMap(({ pressing: _pressing, ...property }) => {
    const sections = property.sections.flatMap((section): PortalOverviewSection[] => {
      const items = section.items.filter((item) => onPage.has(item))
      return items.length === 0 ? [] : [{ ...section, items }]
    })
    return sections.length === 0 ? [] : [{ ...property, sections }]
  })

  return {
    properties: shown,
    propertyCount: byProperty.size,
    total: rows.length,
    matched: everyItem.length,
    page,
    lastPage,
    from: onPage.size === 0 ? 0 : start + 1,
    to: start + onPage.size,
  }
}
