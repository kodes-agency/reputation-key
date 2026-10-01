// The Pool & Terrace ledger of board 08, as data for stories: the same entries,
// versions and restore preview the History tab reads, so a story shows the
// board's sentences exactly. Not imported by production code.

import type {
  PortalHistoryEntry,
  PortalVersionDetail,
  PortalVersionItem,
  PortalVersions,
} from '#/contexts/portal/application/public-api'

/** Board 08's "2 h ago" moment: 30 Sep 2026, 10:05 in Sofia (UTC+3) is 07:05 UTC. */
export const STORY_NOW = new Date('2026-09-30T07:05:00.000Z')
export const STORY_TIME_ZONE = 'Europe/Sofia'
export const STORY_PORTAL_NAME = 'Pool & Terrace'
export const STORY_PENDING_CHANGES = 2

const elena = { userId: 'user-elena', displayName: 'Elena Petrova' }
const georgi = { userId: 'user-georgi', displayName: 'Georgi Ivanov' }

const edit = (
  key: string,
  occurredAt: string,
  actor: PortalHistoryEntry['actor'],
  subject: Extract<PortalHistoryEntry['detail'], { kind: 'page_edited' }>['subject'],
  wording: Readonly<{ previousText?: string; newText?: string }> = {},
): PortalHistoryEntry => ({
  key: `edit:${key}`,
  category: 'edits',
  occurredAt,
  actor,
  detail: {
    kind: 'page_edited',
    subject,
    propertyWide: false,
    previousText: wording.previousText ?? null,
    newText: wording.newText ?? null,
    editCount: 1,
  },
})

const publication = (
  version: number,
  occurredAt: string,
  actor: PortalHistoryEntry['actor'],
): PortalHistoryEntry => ({
  key: `publication:v${version}`,
  category: 'publishing',
  occurredAt,
  actor,
  detail: { kind: 'version_published', version },
})

/** Newest first, as the merged read returns it. */
export const STORY_ENTRIES: readonly PortalHistoryEntry[] = [
  edit(
    'e1',
    '2026-09-30T05:05:00.000Z',
    elena,
    { area: 'welcome_text', locale: 'es' },
    {
      previousText: 'Zona de piscina',
      newText: 'Piscina y terraza',
    },
  ),
  edit(
    'e2',
    '2026-09-29T13:40:00.000Z',
    georgi,
    { area: 'link', linkId: 'l-dinner', change: 'updated' },
    { previousText: 'Dinner menu', newText: 'Olive Terrace menu' },
  ),
  publication(5, '2026-09-22T08:20:00.000Z', elena),
  edit(
    'e3',
    '2026-09-21T12:02:00.000Z',
    elena,
    { area: 'link', linkId: 'l-here', change: 'created' },
    {
      newText: 'Getting here',
    },
  ),
  edit('e4', '2026-09-19T07:48:00.000Z', elena, {
    area: 'page_settings',
    field: 'additional_languages',
  }),
  {
    key: 'code-downloaded:d2',
    category: 'codes',
    occurredAt: '2026-09-03T11:02:00.000Z',
    actor: georgi,
    detail: { kind: 'code_downloaded', version: 1, purpose: 'download' },
  },
  publication(4, '2026-08-28T13:12:00.000Z', elena),
  edit(
    'e5',
    '2026-08-27T14:30:00.000Z',
    elena,
    { area: 'link', linkId: 'l-resort', change: 'created' },
    {
      newText: 'Discover the resort',
    },
  ),
  {
    key: 'health:h1',
    category: 'health',
    occurredAt: '2026-08-21T06:30:00.000Z',
    actor: null,
    detail: { kind: 'health_changed', status: 'healthy', reason: 'operational' },
  },
  {
    key: 'code-downloaded:d1',
    category: 'codes',
    occurredAt: '2026-08-12T09:25:00.000Z',
    actor: elena,
    detail: { kind: 'code_downloaded', version: 1, purpose: 'copy' },
  },
  publication(3, '2026-07-14T07:05:00.000Z', georgi),
  publication(2, '2026-04-09T10:40:00.000Z', georgi),
  publication(1, '2026-03-12T09:15:00.000Z', georgi),
  {
    key: 'created:portal',
    category: 'publishing',
    occurredAt: '2026-03-12T07:40:00.000Z',
    actor: georgi,
    detail: { kind: 'portal_created' },
  },
]

const version = (
  n: number,
  publishedAt: string,
  by: PortalVersionItem['publishedBy'],
  changes: PortalVersionItem['changes'],
  languages: PortalVersionItem['languages'] = ['en', 'bg'],
): PortalVersionItem => ({
  version: n,
  publishedAt,
  publishedBy: by,
  isLive: n === 5,
  isFirst: n === 1,
  languages,
  changes,
})

export const STORY_VERSIONS: PortalVersions = {
  versions: [
    version(
      5,
      '2026-09-22T08:20:00.000Z',
      elena,
      [
        { kind: 'language_added', locale: 'de' },
        { kind: 'link_added', label: 'Getting here', hasPhoto: false },
      ],
      ['en', 'bg', 'es', 'de'],
    ),
    version(
      4,
      '2026-08-28T13:12:00.000Z',
      elena,
      [{ kind: 'link_added', label: 'Discover the resort', hasPhoto: true }],
      ['en', 'bg', 'es'],
    ),
    version(
      3,
      '2026-07-14T07:05:00.000Z',
      georgi,
      [{ kind: 'language_added', locale: 'es' }],
      ['en', 'bg', 'es'],
    ),
    version(2, '2026-04-09T10:40:00.000Z', georgi, [
      { kind: 'link_added', label: 'Dinner menu', hasPhoto: false },
    ]),
    version(1, '2026-03-12T09:15:00.000Z', georgi, []),
  ],
  liveVersion: 5,
  draft: {
    basedOnVersion: 5,
    lastEdit: { at: '2026-09-30T05:05:00.000Z', actor: elena },
  },
  truncated: false,
}

/** What making version 4 live again would do: board 08's open confirmation. */
export const STORY_VERSION_4: PortalVersionDetail = {
  version: 4,
  publishedAt: '2026-08-28T13:12:00.000Z',
  publishedBy: elena,
  isLive: false,
  liveVersion: 5,
  nextVersion: 6,
  newestVersion: 5,
  content: {
    primaryLanguage: 'en',
    languages: ['en', 'bg', 'es'],
    title: 'Pool & Terrace',
    links: [
      { label: 'Dinner menu', address: 'https://avela.example/dinner' },
      { label: 'Discover the resort', address: 'https://avela.example/resort' },
    ],
    linktreeEnabled: true,
  },
  changesFromLive: [
    { kind: 'link_removed', label: 'Getting here', hasPhoto: false },
    { kind: 'language_removed', locale: 'de' },
  ],
}

export const STORY_VERSION_DETAILS: Readonly<Record<number, PortalVersionDetail>> = {
  4: STORY_VERSION_4,
  3: {
    ...STORY_VERSION_4,
    version: 3,
    publishedAt: '2026-07-14T07:05:00.000Z',
    publishedBy: georgi,
    content: { ...STORY_VERSION_4.content, languages: ['en', 'bg', 'es'] },
    changesFromLive: [
      { kind: 'link_removed', label: 'Getting here', hasPhoto: false },
      { kind: 'link_removed', label: 'Discover the resort', hasPhoto: true },
      { kind: 'language_removed', locale: 'de' },
    ],
  },
  5: {
    ...STORY_VERSION_4,
    version: 5,
    publishedAt: '2026-09-22T08:20:00.000Z',
    isLive: true,
    changesFromLive: [],
  },
}

/**
 * Version 4 was made live again after version 5: the draft is still based on
 * version 5, the newest, though guests see version 4.
 */
export const STORY_LIVE_4_VERSIONS: PortalVersions = {
  ...STORY_VERSIONS,
  liveVersion: 4,
  versions: STORY_VERSIONS.versions.map((item) => ({
    ...item,
    isLive: item.version === 4,
  })),
}

export const STORY_LIVE_4_DETAILS: Readonly<Record<number, PortalVersionDetail>> = {
  3: {
    ...STORY_VERSION_4,
    version: 3,
    publishedAt: '2026-07-14T07:05:00.000Z',
    publishedBy: georgi,
    liveVersion: 4,
    changesFromLive: [
      { kind: 'link_removed', label: 'Discover the resort', hasPhoto: true },
    ],
  },
  5: {
    ...STORY_VERSION_4,
    version: 5,
    publishedAt: '2026-09-22T08:20:00.000Z',
    liveVersion: 4,
    changesFromLive: [
      { kind: 'link_added', label: 'Getting here', hasPhoto: false },
      { kind: 'language_added', locale: 'de' },
    ],
  },
}

/** The merged read as the server answers it: the category filter applied. */
export function storyHistoryFor(filter: string): readonly PortalHistoryEntry[] {
  return filter === 'all'
    ? STORY_ENTRIES
    : STORY_ENTRIES.filter((entry) => entry.category === filter)
}
