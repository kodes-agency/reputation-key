// fallow-ignore-file code-duplication
// r4 s38: parallel dialog forms, server-function shells and ledger rows share intentional boilerplate.
// The Portals overview as data: which Portals are listed, in which groups, in
// which order and on which page, and the words each row carries. Pure, so every
// rule (search, the attention filter, group order, paging across groups) is
// tested without a table, and the table only draws what this decides.
import { personInitials } from '#/components/inbox/person-initials'
import { searchMatcher } from '#/components/property/property-search'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import {
  GUEST_LOCALE_METADATA,
  adminLanguageCode,
  type GuestLocale,
} from '#/shared/domain/guest-locale'
import { needsAttention, portalAttention, type PortalAttention } from './portal-attention'
import { compareItems, orderGroups } from './portal-overview-order'
import type { OverviewSortFigures } from './portal-overview-results'
import {
  DEFAULT_PORTAL_OVERVIEW_GROUP_BY,
  DEFAULT_PORTAL_OVERVIEW_SORT,
  defaultSortDirection,
  type PortalOverviewSearch,
} from './portal-overview-search-schema'

/** A QR code per room means a Property can hold hundreds of Portals: the list is paged. */
export const PORTAL_OVERVIEW_PAGE_SIZE = 20

const MAX_NAMED_MANAGERS = 3

export type PortalManagerName = Readonly<{ userId: string; name: string }>

export type PortalManagerView = Readonly<{
  userId: string
  /** Null when the directory cannot name them: an id is never shown instead. */
  name: string | null
  initials: string | null
}>

export type PortalManagersView = Readonly<{
  managers: readonly PortalManagerView[]
  /** What a screen reader hears, and what the stack's label says. */
  description: string
  isEmpty: boolean
}>

export type PortalLocaleChip = Readonly<{
  code: GuestLocale
  label: string
  name: string
}>

export type PortalLocalesView = Readonly<{
  chips: readonly PortalLocaleChip[]
  description: string
}>

export type PortalOverviewItem = Readonly<{
  row: PortalOverviewRow
  attention: PortalAttention
  /** The code a Portal has: `QR and NFC`, never a kind of place. */
  channel: string
  locales: PortalLocalesView
  managers: PortalManagersView
}>

export type PortalOverviewSection = Readonly<{
  /** `group` and `ungrouped` carry a head row; `flat` is the list with no grouping. */
  kind: 'group' | 'ungrouped' | 'flat'
  key: string
  group: PortalOverviewRow['group']
  /** Every Portal in the group, whatever the search left. */
  memberCount: number
  /** The Portals of the group the search and filter keep, on every page. */
  matchedCount: number
  /** The ones on this page. */
  items: readonly PortalOverviewItem[]
}>

export type PortalOverviewPage = Readonly<{
  sections: readonly PortalOverviewSection[]
  /** Every Portal, before the search. */
  total: number
  /** The Portals the search and filter keep, on every page. */
  matched: number
  /** Every Portal that needs attention, before the search: what the filter would keep. */
  needingAttention: number
  page: number
  lastPage: number
  /** 1-based position of the first and last Portal on this page; 0 when none. */
  from: number
  to: number
}>

export function channelLabel(token: PortalOverviewRow['token']): string {
  return token.hasActiveToken ? 'QR and NFC' : 'No code yet'
}

export function localeChips(
  primary: GuestLocale,
  additional: readonly GuestLocale[],
): PortalLocalesView {
  const codes = [primary, ...additional.filter((code) => code !== primary)]
  const chips = codes.map((code) => ({
    code,
    label: adminLanguageCode(code),
    name: GUEST_LOCALE_METADATA[code].englishName,
  }))
  const names = chips.map((chip) => chip.name).join(', ')
  return {
    chips,
    description: `${chips.length === 1 ? 'Language' : 'Languages'}: ${names}`,
  }
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function describeManagers(
  userIds: readonly string[],
  members: readonly PortalManagerName[],
): PortalManagersView {
  if (userIds.length === 0) return { managers: [], description: 'No one', isEmpty: true }
  const nameById = new Map(members.map((member) => [member.userId, member.name.trim()]))
  const managers = userIds.map((userId): PortalManagerView => {
    const name = nameById.get(userId) || null
    return { userId, name, initials: name === null ? null : personInitials(name) }
  })
  const named = managers.flatMap((manager) => (manager.name ? [manager.name] : []))
  if (named.length === 0) {
    return {
      managers,
      description: plural(managers.length, 'manager', 'managers'),
      isEmpty: false,
    }
  }
  const shown = named.slice(0, MAX_NAMED_MANAGERS)
  const rest = managers.length - shown.length
  return {
    managers,
    description: rest === 0 ? joinNames(shown) : `${shown.join(', ')} and ${rest} more`,
    isEmpty: false,
  }
}

export function describeGroupCount(members: number, matched: number): string {
  return matched === members
    ? plural(members, 'portal', 'portals')
    : `${matched} of ${plural(members, 'portal', 'portals')}`
}

export function describeRange(
  page: Pick<PortalOverviewPage, 'from' | 'to' | 'matched'>,
): string {
  return page.matched === 0 ? '' : `Showing ${page.from}–${page.to} of ${page.matched}`
}

function toItem(
  row: PortalOverviewRow,
  members: readonly PortalManagerName[],
): PortalOverviewItem {
  return {
    row,
    attention: portalAttention(row),
    channel: channelLabel(row.token),
    locales: localeChips(row.primaryGuestLocale, row.additionalGuestLocales),
    managers: describeManagers(row.responsibleManagerUserIds, members),
  }
}

function matchesSearch(
  item: PortalOverviewItem,
  search: PortalOverviewSearch,
  matchesText: (text: string) => boolean,
): boolean {
  if (!matchesText(`${item.row.name} ${item.row.group?.name ?? ''}`)) return false
  return search.show !== 'attention' || needsAttention(item.attention)
}

type Bucket = Readonly<{
  kind: 'group' | 'ungrouped'
  key: string
  group: PortalOverviewRow['group']
  memberCount: number
  items: readonly PortalOverviewItem[]
}>

function bucketByGroup(
  items: readonly PortalOverviewItem[],
  memberCounts: ReadonlyMap<string, number>,
  ungroupedCount: number,
): readonly Bucket[] {
  const byGroup = new Map<string, PortalOverviewItem[]>()
  const ungrouped: PortalOverviewItem[] = []
  for (const item of items) {
    const group = item.row.group
    if (!group) ungrouped.push(item)
    else byGroup.set(group.id, [...(byGroup.get(group.id) ?? []), item])
  }
  const groups = [...byGroup.values()].flatMap((groupItems): Bucket[] => {
    const group = groupItems[0]?.row.group
    if (!group) return []
    return [
      {
        kind: 'group',
        key: group.id,
        group,
        memberCount: memberCounts.get(group.id) ?? groupItems.length,
        items: groupItems,
      },
    ]
  })
  return [
    ...groups,
    ...(ungrouped.length > 0
      ? [
          {
            kind: 'ungrouped' as const,
            key: 'ungrouped',
            group: null,
            memberCount: ungroupedCount,
            items: ungrouped,
          },
        ]
      : []),
  ]
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

const compareNames = (a: string, b: string): number =>
  a.toLowerCase().localeCompare(b.toLowerCase())

/**
 * The groups of the Property that hold no Portal, as heads with nothing under
 * them, so a group made first (or emptied) stays reachable. Shown on the last
 * page, before the ungrouped Portals, and only while the list is grouped and
 * nothing narrows it.
 */
function emptyGroupSections(
  known: readonly NonNullable<PortalOverviewRow['group']>[],
  used: ReadonlySet<string>,
): readonly PortalOverviewSection[] {
  return known
    .filter((group) => !used.has(group.id))
    .sort((a, b) => compareNames(a.name, b.name))
    .map((group) => ({
      kind: 'group' as const,
      key: group.id,
      group,
      memberCount: 0,
      matchedCount: 0,
      items: [],
    }))
}

/** Places `extra` before the ungrouped Portals, or at the end when there are none. */
function withBeforeUngrouped(
  sections: readonly PortalOverviewSection[],
  extra: readonly PortalOverviewSection[],
): readonly PortalOverviewSection[] {
  if (extra.length === 0) return sections
  const at = sections.findIndex((section) => section.kind === 'ungrouped')
  return at < 0
    ? [...sections, ...extra]
    : [...sections.slice(0, at), ...extra, ...sections.slice(at)]
}

export function buildPortalOverview(
  rows: readonly PortalOverviewRow[],
  search: PortalOverviewSearch,
  members: readonly PortalManagerName[],
  pageSize: number = PORTAL_OVERVIEW_PAGE_SIZE,
  /** What the results say each row counted, for the scans sort; none until they arrive. */
  figures?: OverviewSortFigures,
  /** Every group of the Property, so one with no Portal can still be listed. */
  knownGroups: readonly NonNullable<PortalOverviewRow['group']>[] = [],
): PortalOverviewPage {
  const sort = search.sort ?? DEFAULT_PORTAL_OVERVIEW_SORT
  const dir = search.dir ?? defaultSortDirection(sort)
  const grouping = (search.groupBy ?? DEFAULT_PORTAL_OVERVIEW_GROUP_BY) === 'group'

  const all = rows.map((row) => toItem(row, members))
  const matchesText = searchMatcher(search.q ?? '')
  const matched = all
    .filter((item) => matchesSearch(item, search, matchesText))
    .sort(compareItems(sort, dir, figures))

  const memberCounts = new Map<string, number>()
  for (const item of all) {
    const id = item.row.group?.id
    if (id) memberCounts.set(id, (memberCounts.get(id) ?? 0) + 1)
  }
  const ungroupedCount = all.filter((item) => !item.row.group).length

  const buckets: readonly Bucket[] = grouping
    ? orderGroups(
        bucketByGroup(matched, memberCounts, ungroupedCount),
        sort,
        dir,
        figures,
      )
    : matched.length === 0
      ? []
      : [
          {
            kind: 'group',
            key: 'flat',
            group: null,
            memberCount: all.length,
            items: matched,
          },
        ]

  const ordered = buckets.flatMap((bucket) => bucket.items)
  const lastPage = Math.max(1, Math.ceil(ordered.length / pageSize))
  const page = clamp(search.page ?? 1, 1, lastPage)
  const start = (page - 1) * pageSize
  const onPage = new Set(ordered.slice(start, start + pageSize))

  const sections = buckets.flatMap((bucket): PortalOverviewSection[] => {
    const items = bucket.items.filter((item) => onPage.has(item))
    if (items.length === 0) return []
    return [
      {
        kind: grouping ? bucket.kind : 'flat',
        key: bucket.key,
        group: bucket.group,
        memberCount: bucket.memberCount,
        matchedCount: bucket.items.length,
        items,
      },
    ]
  })

  const narrowed = (search.q?.trim() ?? '') !== '' || search.show !== undefined
  const emptyGroups =
    grouping && !narrowed && page === lastPage
      ? emptyGroupSections(knownGroups, new Set(memberCounts.keys()))
      : []

  return {
    sections: withBeforeUngrouped(sections, emptyGroups),
    total: all.length,
    matched: matched.length,
    needingAttention: all.filter((item) => needsAttention(item.attention)).length,
    page,
    lastPage,
    from: onPage.size === 0 ? 0 : start + 1,
    to: start + onPage.size,
  }
}
