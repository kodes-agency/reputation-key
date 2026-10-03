// The Portals overview's URL: what is searched, shown, grouped, sorted, which
// page is open and whether the New portal dialog is. Every key is optional with no default, so the default view is a
// bare `/portals` and a value a hand-edited URL cannot mean is dropped rather
// than refusing the page (the same rule as the Properties list).
import { z } from 'zod/v4'
import { MAX_LIST_SEARCH_LENGTH } from '#/components/property/list-search-limit'

export const PORTAL_OVERVIEW_SORTS = ['name', 'attention', 'scans'] as const
export type PortalOverviewSort = (typeof PORTAL_OVERVIEW_SORTS)[number]

export const PORTAL_OVERVIEW_GROUP_BYS = ['group', 'none'] as const
export type PortalOverviewGroupBy = (typeof PORTAL_OVERVIEW_GROUP_BYS)[number]

const PORTAL_OVERVIEW_SHOWS = ['attention'] as const
export type PortalOverviewShow = (typeof PORTAL_OVERVIEW_SHOWS)[number]

export type SortDirection = 'asc' | 'desc'

/** The longest search the URL keeps; the box stops here rather than clearing itself. */
export const MAX_SEARCH_LENGTH = MAX_LIST_SEARCH_LENGTH

export const DEFAULT_PORTAL_OVERVIEW_SORT: PortalOverviewSort = 'name'
export const DEFAULT_PORTAL_OVERVIEW_GROUP_BY: PortalOverviewGroupBy = 'group'

/** A name reads A to Z; attention and scans read the most first. */
export function defaultSortDirection(sort: PortalOverviewSort): SortDirection {
  return sort === 'name' ? 'asc' : 'desc'
}

export const portalOverviewSearchSchema = z.object({
  q: z.string().max(MAX_SEARCH_LENGTH).optional().catch(undefined),
  groupBy: z.enum(PORTAL_OVERVIEW_GROUP_BYS).optional().catch(undefined),
  show: z.enum(PORTAL_OVERVIEW_SHOWS).optional().catch(undefined),
  sort: z.enum(PORTAL_OVERVIEW_SORTS).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  // Whether the New portal dialog is open. In the URL so a reload keeps it, and
  // so the old /portals/new address can redirect here.
  new: z
    .union([z.literal(true), z.literal('true'), z.literal(1), z.literal('1')])
    .transform((): true => true)
    .optional()
    .catch(undefined),
})

export type PortalOverviewSearch = z.infer<typeof portalOverviewSearchSchema>

/**
 * The All properties page keeps the search, the order and the page. It has no
 * filter or grouping control, so a bookmarked `show` or `groupBy` is dropped.
 */
export const allPropertiesSearchSchema = portalOverviewSearchSchema.pick({
  q: true,
  sort: true,
  dir: true,
  page: true,
})

export type AllPropertiesSearch = z.infer<typeof allPropertiesSearchSchema>

const isBlank = (value: string | undefined): boolean =>
  value === undefined || value.trim() === ''

/**
 * The next search after `patch`, written as the URL should carry it: a key that
 * says the default (or nothing) is left out, so the default view stays bare, and
 * anything that changes which Portals are listed sends the reader back to the
 * first page unless the patch names a page itself.
 */
export function portalOverviewSearchPatch(
  current: PortalOverviewSearch,
  patch: Partial<PortalOverviewSearch>,
): PortalOverviewSearch {
  const merged: PortalOverviewSearch = { ...current, ...patch }
  const changesList = ['q', 'groupBy', 'show', 'sort', 'dir'].some((key) => key in patch)
  const page = 'page' in patch ? merged.page : changesList ? undefined : merged.page
  const sort = merged.sort ?? DEFAULT_PORTAL_OVERVIEW_SORT
  const next: PortalOverviewSearch = {
    ...(isBlank(merged.q) ? {} : { q: merged.q }),
    ...(merged.groupBy === undefined ||
    merged.groupBy === DEFAULT_PORTAL_OVERVIEW_GROUP_BY
      ? {}
      : { groupBy: merged.groupBy }),
    ...(merged.show === undefined ? {} : { show: merged.show }),
    ...(sort === DEFAULT_PORTAL_OVERVIEW_SORT ? {} : { sort }),
    ...(merged.dir === undefined || merged.dir === defaultSortDirection(sort)
      ? {}
      : { dir: merged.dir }),
    ...(page === undefined || page <= 1 ? {} : { page }),
    ...(merged.new === true ? { new: true as const } : {}),
  }
  return next
}
