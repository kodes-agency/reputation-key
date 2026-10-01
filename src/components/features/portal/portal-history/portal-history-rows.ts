// The rows of the History ledger: the merged read, joined with the versions
// read, shaped for one filter. Pure.
//
// The History read says what happened; the versions read says which version an
// edit went into and what each version added. This joins them, folds the edits
// that belong to a version under that version's publish line on All (so a
// version is one line, not a line and thirty edits), and tucks the oldest
// versions behind one "N earlier versions" line.

import type {
  PortalHistoryEntry,
  PortalVersionItem,
  PortalVersions,
} from '#/contexts/portal/application/public-api'

export type HistoryFilterKey = 'all' | 'publishing' | 'codes' | 'edits'

export const HISTORY_FILTERS: ReadonlyArray<
  Readonly<{ key: HistoryFilterKey; label: string }>
> = [
  { key: 'all', label: 'All' },
  { key: 'publishing', label: 'Publishing' },
  { key: 'codes', label: 'Codes' },
  { key: 'edits', label: 'Page edits' },
]

/** Where a page edit stands: still in the draft, or published in a version. */
export type DraftState =
  Readonly<{ kind: 'draft' }> | Readonly<{ kind: 'published'; version: number }>

/** Versions beyond these newest ones fold into one line on All. */
const VISIBLE_VERSIONS_ON_ALL = 2

export type HistoryEntryRow = Readonly<{
  kind: 'entry'
  key: string
  entry: PortalHistoryEntry
  /** Page edits only; null when the versions are not known or the edit is too old to place. */
  draft: DraftState | null
  /** The newest line of the version guests see now. */
  isLive: boolean
  /** The version a publication line stands for, for its summary and its actions. */
  version: PortalVersionItem | null
}>

export type EarlierVersionsRow = Readonly<{
  kind: 'earlier_versions'
  key: 'earlier-versions'
  /** Newest first. */
  versions: readonly PortalVersionItem[]
}>

export type HistoryRow = HistoryEntryRow | EarlierVersionsRow

/**
 * The first version published at or after the edit holds it; an edit after
 * the newest version is in the draft. A list cut short cannot place an edit
 * older than its oldest version, so it says nothing.
 */
export function draftStateOf(
  editedAt: string,
  versions: PortalVersions | null,
): DraftState | null {
  if (versions === null) return null
  const at = new Date(editedAt).getTime()
  const oldestFirst = [...versions.versions].reverse()
  const holder = oldestFirst.find((item) => new Date(item.publishedAt).getTime() >= at)
  if (holder === undefined) return { kind: 'draft' }
  if (versions.truncated && holder === oldestFirst[0]) return null
  return { kind: 'published', version: holder.version }
}

type Inputs = Readonly<{
  entries: readonly PortalHistoryEntry[]
  versions: PortalVersions | null
  filter: HistoryFilterKey
  showEarlier: boolean
}>

function toRows(entries: readonly PortalHistoryEntry[], versions: PortalVersions | null) {
  const byNumber = new Map(versions?.versions.map((item) => [item.version, item]) ?? [])
  let liveSeen = false
  return entries.map((entry): HistoryEntryRow => {
    const { detail } = entry
    const number =
      detail.kind === 'version_published' || detail.kind === 'version_restored'
        ? detail.version
        : null
    const isLive =
      !liveSeen && number !== null && versions !== null && number === versions.liveVersion
    if (isLive) liveSeen = true
    return {
      kind: 'entry',
      key: entry.key,
      entry,
      draft:
        detail.kind === 'page_edited' ? draftStateOf(entry.occurredAt, versions) : null,
      isLive,
      version:
        detail.kind === 'version_published'
          ? (byNumber.get(detail.version) ?? null)
          : null,
    }
  })
}

function foldEditsAndCreation(
  rows: readonly HistoryEntryRow[],
  filter: HistoryFilterKey,
): readonly HistoryEntryRow[] {
  if (filter === 'publishing') {
    return rows.filter((row) => row.entry.detail.kind !== 'portal_created')
  }
  if (filter === 'all') {
    return rows.filter((row) => row.draft === null || row.draft.kind === 'draft')
  }
  return rows
}

/** The older publish lines, tucked into one row at the place of the newest of them. */
function collapseEarlierVersions(
  rows: readonly HistoryEntryRow[],
): readonly HistoryRow[] {
  const publishes = rows.filter((row) => row.entry.detail.kind === 'version_published')
  const tucked = publishes.slice(VISIBLE_VERSIONS_ON_ALL)
  const items = tucked.flatMap((row) => (row.version === null ? [] : [row.version]))
  if (tucked.length < 2 || items.length !== tucked.length) return rows
  const hidden = new Set(tucked.map((row) => row.key))
  const first = tucked[0]?.key
  return rows.flatMap((row): readonly HistoryRow[] => {
    if (row.key === first)
      return [{ kind: 'earlier_versions', key: 'earlier-versions', versions: items }]
    return hidden.has(row.key) ? [] : [row]
  })
}

export function buildHistoryRows({
  entries,
  versions,
  filter,
  showEarlier,
}: Inputs): readonly HistoryRow[] {
  const rows = foldEditsAndCreation(toRows(entries, versions), filter)
  return filter === 'all' && !showEarlier && versions !== null
    ? collapseEarlierVersions(rows)
    : rows
}
