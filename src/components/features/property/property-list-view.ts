// The Properties list as data: rows, the view its URL asks for, and the rules
// that search, filter, sort and summarise them. Pure, so every rule is tested
// without rendering (docs/plan/property-list-table.md rows 7, 11–13).
import type { PropertySetupStep } from '#/contexts/reporting/application/public-api'
import { countryLabel } from '#/components/features/shared/country-label'
import type { GoogleBindingState } from './property-lifecycle-model'
import type {
  PropertyListSearch,
  PropertyListShow,
  PropertyListSort,
  SortDirection,
} from './property-list-search-schema'

/** Whether an enrichment read has arrived, is on its way, or will not come. */
export type DataState = 'loading' | 'ready' | 'unavailable'

export type PropertyListProperty = Readonly<{
  id: string
  name: string
  address: string | null
  countryCode: string | null
  googleBindingState: GoogleBindingState
  lifecycleState: string
}>

export type PropertyAttention = Readonly<{
  /** Distinct work waiting. Never the sum of the parts below: they overlap. */
  total: number
  /** Replies past their due time; always part of `itemsToTriage`. */
  overdue: number
  /** Every open inbox item — exactly the Inbox's `open` queue. */
  itemsToTriage: number
  /** Unresolved escalations, open or closed. */
  escalated: number
  goalsBehindPace: number
}>

/** What the fleet read adds to a row. Rating and reviews are all-time. */
export type PropertyComparison = Readonly<{
  avgRating: number | null
  reviewCount: number
  attention: PropertyAttention
}>

export type PropertySetupProgress = Readonly<{
  completedCount: number
  stepCount: number
  nextStep: PropertySetupStep | null
}>

export type PropertyListRow = Readonly<{
  property: PropertyListProperty
  /** Absent while the fleet read is pending or when it is unavailable. */
  comparison: PropertyComparison | undefined
  setup: PropertySetupProgress | undefined
  country: string | null
  paused: boolean
}>

export function buildPropertyListRows(
  properties: ReadonlyArray<PropertyListProperty>,
  comparison: ReadonlyMap<string, PropertyComparison> | undefined,
  setup: ReadonlyMap<string, PropertySetupProgress> | undefined,
): PropertyListRow[] {
  return properties.map((property) => ({
    property,
    comparison: comparison?.get(property.id),
    setup: setup?.get(property.id),
    country: property.countryCode ? countryLabel(property.countryCode) : null,
    paused: property.lifecycleState === 'suspended',
  }))
}

// ── The view the URL asks for ─────────────────────────────────────────

const DEFAULT_SORT: PropertyListSort = 'attention'

const DEFAULT_DIRECTION: Readonly<Record<PropertyListSort, SortDirection>> = {
  attention: 'desc',
  name: 'asc',
  rating: 'desc',
  reviews: 'desc',
  // Least done first: the property that needs setting up rises.
  setup: 'asc',
}

export function defaultSortDirection(sort: PropertyListSort): SortDirection {
  return DEFAULT_DIRECTION[sort]
}

export type PropertyListData = Readonly<{ fleet: DataState; setup: DataState }>

export type PropertyListView = Readonly<{
  q: string
  /** The filter in force; `null` when none is, or its read is unavailable. */
  show: PropertyListShow | null
  /** The sort the controls show. */
  sort: PropertyListSort
  dir: SortDirection
  /** The order applied now: name while the figures `sort` needs are loading. */
  appliedSort: PropertyListSort
  appliedDir: SortDirection
}>

function sortRead(sort: PropertyListSort): keyof PropertyListData | null {
  if (sort === 'name') return null
  return sort === 'setup' ? 'setup' : 'fleet'
}

function showRead(show: PropertyListShow): keyof PropertyListData | null {
  if (show === 'google') return null
  return show === 'setup' ? 'setup' : 'fleet'
}

export function resolvePropertyListView(
  search: PropertyListSearch,
  data: PropertyListData,
): PropertyListView {
  const requested = search.sort ?? DEFAULT_SORT
  const requestedRead = sortRead(requested)
  // A sort whose read will not come is not offered: fall back to name.
  const sort =
    requestedRead !== null && data[requestedRead] === 'unavailable' ? 'name' : requested
  const dir = search.sort === sort && search.dir ? search.dir : DEFAULT_DIRECTION[sort]
  const read = sortRead(sort)
  const pending = read !== null && data[read] === 'loading'
  const filterRead = search.show ? showRead(search.show) : null
  const show =
    search.show && (filterRead === null || data[filterRead] !== 'unavailable')
      ? search.show
      : null

  return {
    q: search.q ?? '',
    show,
    sort,
    dir,
    appliedSort: pending ? 'name' : sort,
    appliedDir: pending ? DEFAULT_DIRECTION.name : dir,
  }
}

/**
 * The next URL search: `current` with `patch` applied, and every value equal to
 * its default removed, so the default view stays a bare `/properties`.
 */
export function propertyListSearchPatch(
  current: PropertyListSearch,
  patch: Partial<PropertyListSearch>,
): PropertyListSearch {
  const next = { ...current, ...patch }
  const sort = next.sort ?? DEFAULT_SORT
  return {
    ...(next.q ? { q: next.q } : {}),
    ...(next.show ? { show: next.show } : {}),
    ...(sort !== DEFAULT_SORT ? { sort } : {}),
    ...(next.dir && next.dir !== DEFAULT_DIRECTION[sort] ? { dir: next.dir } : {}),
  }
}

// ── Search and filter ─────────────────────────────────────────────────

/** Case- and accent-insensitive: "cafe" finds "Café", "СТАРА" finds "Стара". */
function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

function matchesQuery(row: PropertyListRow, query: string): boolean {
  const haystack = [row.property.name, row.property.address, row.country]
    .filter((part): part is string => part !== null)
    .map(searchable)
  return haystack.some((part) => part.includes(query))
}

function matchesShow(row: PropertyListRow, show: PropertyListShow): boolean {
  switch (show) {
    case 'attention':
      // A row whose figures have not arrived stays until they say otherwise.
      return row.comparison === undefined || row.comparison.attention.total > 0
    case 'setup':
      return row.setup === undefined || row.setup.completedCount < row.setup.stepCount
    case 'google':
      return row.property.googleBindingState !== 'active'
  }
}

export function filterPropertyListRows(
  rows: ReadonlyArray<PropertyListRow>,
  view: Readonly<{ q: string; show: PropertyListShow | null }>,
): PropertyListRow[] {
  const query = searchable(view.q.trim())
  return rows.filter(
    (row) =>
      (query === '' || matchesQuery(row, query)) &&
      (view.show === null || matchesShow(row, view.show)),
  )
}

// ── Sort ──────────────────────────────────────────────────────────────

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

type SortKey = number | null

/** Unknown values sort last in either direction — never read as zero. */
function compareKeys(a: SortKey, b: SortKey, dir: SortDirection): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return dir === 'asc' ? a - b : b - a
}

function keyOf(row: PropertyListRow, sort: Exclude<PropertyListSort, 'name'>): SortKey {
  switch (sort) {
    case 'attention':
      return row.comparison?.attention.total ?? null
    case 'rating':
      return row.comparison?.avgRating ?? null
    case 'reviews':
      return row.comparison?.reviewCount ?? null
    case 'setup':
      return row.setup?.completedCount ?? null
  }
}

function byName(a: PropertyListRow, b: PropertyListRow): number {
  return collator.compare(a.property.name, b.property.name)
}

function tieBreak(a: PropertyListRow, b: PropertyListRow, sort: PropertyListSort) {
  if (sort === 'attention') {
    const bySetup = compareKeys(keyOf(a, 'setup'), keyOf(b, 'setup'), 'asc')
    if (bySetup !== 0) return bySetup
  }
  if (sort === 'rating') {
    const bySample = compareKeys(keyOf(a, 'reviews'), keyOf(b, 'reviews'), 'desc')
    if (bySample !== 0) return bySample
  }
  return byName(a, b)
}

export function sortPropertyListRows(
  rows: ReadonlyArray<PropertyListRow>,
  sort: PropertyListSort,
  dir: SortDirection,
): PropertyListRow[] {
  return [...rows].sort((a, b) => {
    if (sort === 'name') return dir === 'asc' ? byName(a, b) : byName(b, a)
    return compareKeys(keyOf(a, sort), keyOf(b, sort), dir) || tieBreak(a, b, sort)
  })
}

// ── Summary and attention ─────────────────────────────────────────────

export type PropertyListSummary = Readonly<{
  properties: number
  /** Weighted by reviews, as the fleet read weighs it; `null` with no rating. */
  averageRating: number | null
  ratedReviews: number
  needsAttention: number
  propertiesNeedingAttention: number
  propertiesWithSetupLeft: number
  googleLinked: number
}>

export function summarizePropertyList(
  rows: ReadonlyArray<PropertyListRow>,
): PropertyListSummary {
  let weighted = 0
  let ratedReviews = 0
  let needsAttention = 0
  let propertiesNeedingAttention = 0
  let propertiesWithSetupLeft = 0
  let googleLinked = 0
  for (const row of rows) {
    const figures = row.comparison
    if (figures && figures.avgRating !== null) {
      weighted += figures.avgRating * figures.reviewCount
      ratedReviews += figures.reviewCount
    }
    if (figures && figures.attention.total > 0) {
      needsAttention += figures.attention.total
      propertiesNeedingAttention += 1
    }
    if (row.setup && row.setup.completedCount < row.setup.stepCount) {
      propertiesWithSetupLeft += 1
    }
    if (row.property.googleBindingState === 'active') googleLinked += 1
  }
  return {
    properties: rows.length,
    averageRating: ratedReviews > 0 ? weighted / ratedReviews : null,
    ratedReviews,
    needsAttention,
    propertiesNeedingAttention,
    propertiesWithSetupLeft,
    googleLinked,
  }
}

export type AttentionQualifier = Readonly<{ text: string; urgent: boolean }>

/** Facts about the total, in urgency order. "To triage" is the total itself. */
export function attentionQualifiers(attention: PropertyAttention): AttentionQualifier[] {
  const qualifiers: AttentionQualifier[] = []
  if (attention.overdue > 0) {
    qualifiers.push({ text: `${attention.overdue} overdue`, urgent: true })
  }
  if (attention.escalated > 0) {
    qualifiers.push({ text: `${attention.escalated} escalated`, urgent: false })
  }
  if (attention.goalsBehindPace > 0) {
    const goals = attention.goalsBehindPace
    qualifiers.push({
      text: goals === 1 ? '1 goal behind pace' : `${goals} goals behind pace`,
      urgent: false,
    })
  }
  return qualifiers
}

/** Where the count leads: the Inbox queue holding it, else the goals page. */
export function attentionTarget(
  attention: PropertyAttention,
): 'open' | 'escalated' | 'goals' | null {
  if (attention.itemsToTriage > 0) return 'open'
  if (attention.escalated > 0) return 'escalated'
  if (attention.goalsBehindPace > 0) return 'goals'
  return null
}

/** What a row says about Google when it is not linked; linked says nothing. */
export function googleLinkNotice(state: GoogleBindingState): string | null {
  switch (state) {
    case 'active':
      return null
    case 'unbound':
      return 'Google not linked'
    case 'account_confirmation_required':
      return 'Confirm the Google account'
    case 'disconnected':
      return 'Reconnect Google'
  }
}
