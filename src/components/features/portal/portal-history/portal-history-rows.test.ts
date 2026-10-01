import { describe, expect, it } from 'vitest'
import type {
  PortalHistoryDetail,
  PortalHistoryEntry,
  PortalVersionItem,
  PortalVersions,
} from '#/contexts/portal/application/public-api'
import { buildHistoryRows, draftStateOf, type HistoryRow } from './portal-history-rows'

const T = (days: number) =>
  new Date(Date.UTC(2026, 8, 1) + days * 86_400_000).toISOString()

const entry = (
  key: string,
  days: number,
  detail: PortalHistoryDetail,
  category: PortalHistoryEntry['category'] = 'publishing',
): PortalHistoryEntry => ({
  key,
  category,
  occurredAt: T(days),
  actor: { userId: 'u', displayName: 'Elena Petrova' },
  detail,
})

const published = (version: number, days: number) =>
  entry(`publication:${version}`, days, { kind: 'version_published', version })
const restored = (version: number, days: number) =>
  entry(`publication:r${version}`, days, { kind: 'version_restored', version })
const edit = (key: string, days: number) =>
  entry(
    key,
    days,
    {
      kind: 'page_edited',
      subject: { area: 'links' },
      propertyWide: false,
      previousText: null,
      newText: null,
      editCount: 1,
    },
    'edits',
  )
const created = entry('created:p', 0, { kind: 'portal_created' })
const health = entry(
  'health:1',
  7,
  { kind: 'health_changed', status: 'healthy', reason: 'operational' },
  'health',
)
const downloaded = entry(
  'code-downloaded:1',
  8,
  { kind: 'code_downloaded', version: 1, purpose: 'download' },
  'codes',
)

const item = (
  version: number,
  days: number,
  over: Partial<PortalVersionItem> = {},
): PortalVersionItem => ({
  version,
  publishedAt: T(days),
  publishedBy: { userId: 'u', displayName: 'Elena Petrova' },
  isLive: false,
  isFirst: version === 1,
  languages: ['en'],
  changes: [],
  ...over,
})

const versions = (
  list: readonly PortalVersionItem[],
  live: number | null,
  over: Partial<PortalVersions> = {},
): PortalVersions => ({
  versions: [...list].sort((a, b) => b.version - a.version),
  liveVersion: live,
  draft: { basedOnVersion: live, lastEdit: null },
  truncated: false,
  ...over,
})

const keys = (rows: readonly HistoryRow[]) => rows.map((row) => row.key)

describe('draftStateOf', () => {
  const list = versions([item(1, 2), item(2, 10)], 2)

  it('puts an edit in the first version published after it', () => {
    expect(draftStateOf(T(1), list)).toEqual({ kind: 'published', version: 1 })
    expect(draftStateOf(T(2), list)).toEqual({ kind: 'published', version: 1 })
    expect(draftStateOf(T(5), list)).toEqual({ kind: 'published', version: 2 })
  })

  it('calls an edit after the newest version in draft', () => {
    expect(draftStateOf(T(11), list)).toEqual({ kind: 'draft' })
  })

  it('calls every edit of a portal that was never published in draft', () => {
    expect(draftStateOf(T(1), versions([], null))).toEqual({ kind: 'draft' })
  })

  it('says nothing about an edit older than the oldest version it can see', () => {
    const cut = versions([item(5, 10), item(6, 12)], 6, { truncated: true })

    expect(draftStateOf(T(1), cut)).toBeNull()
    expect(draftStateOf(T(11), cut)).toEqual({ kind: 'published', version: 6 })
  })

  it('has no opinion before the versions are known', () => {
    expect(draftStateOf(T(1), null)).toBeNull()
  })
})

describe('buildHistoryRows', () => {
  const all = [
    edit('edit:3', 12),
    published(2, 10),
    edit('edit:2', 9),
    downloaded,
    health,
    published(1, 2),
    edit('edit:1', 1),
    created,
  ]
  const list = versions([item(1, 2), item(2, 10)], 2)

  it('folds edits that went into a version under its publish line on All', () => {
    const rows = buildHistoryRows({
      entries: all,
      versions: list,
      filter: 'all',
      showEarlier: false,
    })

    expect(keys(rows)).toEqual([
      'edit:3',
      'publication:2',
      'code-downloaded:1',
      'health:1',
      'publication:1',
      'created:p',
    ])
    expect(rows[0]).toMatchObject({ kind: 'entry', draft: { kind: 'draft' } })
  })

  it('shows every edit with where it went on the Page edits tab', () => {
    const rows = buildHistoryRows({
      entries: all.filter((row) => row.category === 'edits'),
      versions: list,
      filter: 'edits',
      showEarlier: false,
    })

    expect(rows.map((row) => row.kind === 'entry' && row.draft)).toEqual([
      { kind: 'draft' },
      { kind: 'published', version: 2 },
      { kind: 'published', version: 1 },
    ])
  })

  it('shows only publications on the Publishing tab, without the creation', () => {
    const rows = buildHistoryRows({
      entries: [published(2, 10), published(1, 2), created],
      versions: list,
      filter: 'publishing',
      showEarlier: false,
    })

    expect(keys(rows)).toEqual(['publication:2', 'publication:1'])
  })

  it('marks the live version, and offers View and Make live again on the others', () => {
    const rows = buildHistoryRows({
      entries: [published(2, 10), published(1, 2)],
      versions: list,
      filter: 'publishing',
      showEarlier: false,
    })

    expect(rows[0]).toMatchObject({
      isLive: true,
      version: expect.objectContaining({ version: 2 }),
    })
    expect(rows[1]).toMatchObject({
      isLive: false,
      version: expect.objectContaining({ version: 1 }),
    })
  })

  it('marks live only the newest line of the live version, which may be a restore', () => {
    const rows = buildHistoryRows({
      entries: [restored(1, 12), published(2, 10), published(1, 2)],
      versions: versions([item(1, 2), item(2, 10)], 1),
      filter: 'publishing',
      showEarlier: false,
    })

    expect(rows.map((row) => row.kind === 'entry' && row.isLive)).toEqual([
      true,
      false,
      false,
    ])
  })

  it('has no live line while the page is off', () => {
    const rows = buildHistoryRows({
      entries: [published(2, 10)],
      versions: versions([item(2, 10)], null),
      filter: 'publishing',
      showEarlier: false,
    })

    expect(rows[0]).toMatchObject({ isLive: false })
  })

  it('collapses all but the newest two versions on All, and expands on request', () => {
    const many = [
      published(5, 50),
      published(4, 40),
      published(3, 30),
      health,
      published(2, 20),
      published(1, 10),
      created,
    ]
    const list5 = versions(
      [1, 2, 3, 4, 5].map((n) => item(n, n * 10)),
      5,
    )

    const collapsed = buildHistoryRows({
      entries: many,
      versions: list5,
      filter: 'all',
      showEarlier: false,
    })
    const expanded = buildHistoryRows({
      entries: many,
      versions: list5,
      filter: 'all',
      showEarlier: true,
    })

    expect(keys(collapsed)).toEqual([
      'publication:5',
      'publication:4',
      'earlier-versions',
      'health:1',
      'created:p',
    ])
    expect(collapsed[2]).toMatchObject({
      kind: 'earlier_versions',
      versions: [
        expect.objectContaining({ version: 3 }),
        expect.objectContaining({ version: 2 }),
        expect.objectContaining({ version: 1 }),
      ],
    })
    expect(keys(expanded)).toEqual(many.map((row) => row.key))
  })

  it('does not collapse a single earlier version', () => {
    const rows = buildHistoryRows({
      entries: [published(3, 30), published(2, 20), published(1, 10)],
      versions: versions(
        [1, 2, 3].map((n) => item(n, n * 10)),
        3,
      ),
      filter: 'all',
      showEarlier: false,
    })

    expect(keys(rows)).toEqual(['publication:3', 'publication:2', 'publication:1'])
  })

  it('never collapses on the Publishing tab', () => {
    const rows = buildHistoryRows({
      entries: [5, 4, 3, 2, 1].map((n) => published(n, n * 10)),
      versions: versions(
        [1, 2, 3, 4, 5].map((n) => item(n, n * 10)),
        5,
      ),
      filter: 'publishing',
      showEarlier: false,
    })

    expect(rows).toHaveLength(5)
  })

  it('shows plain rows with no tags before the versions are known', () => {
    const rows = buildHistoryRows({
      entries: all,
      versions: null,
      filter: 'all',
      showEarlier: false,
    })

    expect(keys(rows)).toEqual(all.map((row) => row.key))
    expect(
      rows.every(
        (row) => row.kind === 'entry' && row.draft === null && row.version === null,
      ),
    ).toBe(true)
  })
})
