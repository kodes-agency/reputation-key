import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  buildOrganizationExportBundle,
  CLASSIFICATIONS_BY_CONTEXT,
} from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createPortalOrganizationExportContributor } from './portal-organization-export.adapter'

type Row = Record<string, unknown>

/** The exact order readPayload queries its collections after the clock. */
const READ_ORDER = [
  'portals',
  'portalGroups',
  'portalGroupMembers',
  'linkCategories',
  'links',
  'approvedDestinations',
  'localizedOverrides',
  'brandProfiles',
  'brandContents',
  'publicationSnapshots',
  'publicationActivations',
  'pendingContentChanges',
  'responsibleManagers',
  'accessArtifacts',
  'healthIntervals',
] as const

type Collection = (typeof READ_ORDER)[number]

/**
 * The adapter's determinism contract is about ordering and formatting, not
 * about Postgres, so the unit test drives it through a scripted executor and
 * leaves schema truth to the integration test beside it.
 */
function fakeDatabase(
  responses: Readonly<Partial<Record<Collection, Row[]>>>,
  snapshotAt: string,
) {
  const queue: Row[][] = [
    [{ snapshot_at: snapshotAt }],
    ...READ_ORDER.map((collection) => responses[collection] ?? []),
  ]
  const snapshot = { execute: async () => ({ rows: queue.shift() ?? [] }) }
  return {
    transaction: async (run: (executor: typeof snapshot) => Promise<unknown>) =>
      run(snapshot),
  } as unknown as Database
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const ASOF = new Date('2026-08-28T10:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T10:00:30.000000Z'

const portalRows: Row[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    property_id: 'p0000000-0000-4000-8000-000000000001',
    name: 'Spa, Reception',
    slug: 'spa',
    publication_state: 'published',
    theme: '{"accent": "#123456"}',
    created_at: '2026-01-02T00:00:00.000000Z',
    updated_at: '2026-01-02T00:00:00.000000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    property_id: 'p0000000-0000-4000-8000-000000000001',
    name: 'Front Desk',
    slug: 'front-desk',
    publication_state: 'draft',
    theme: '{}',
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
  },
]

const linkRows: Row[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    portal_id: 'a0000000-0000-4000-8000-000000000001',
    category_id: 'd0000000-0000-4000-8000-000000000001',
    label: 'Menu',
    sort_key: 'b',
    url: 'https://example.test/menu',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    portal_id: 'a0000000-0000-4000-8000-000000000001',
    category_id: 'd0000000-0000-4000-8000-000000000001',
    label: 'Review us',
    sort_key: 'a',
    url: 'https://example.test/review',
  },
]

function contribute(
  responses: Readonly<Partial<Record<Collection, Row[]>>>,
  snapshotAt = SNAPSHOT_AT,
  asOf = ASOF,
) {
  return createPortalOrganizationExportContributor(
    fakeDatabase(responses, snapshotAt),
  ).contribute({ organizationId: 'org-portal-export', requestId: 'req-1', asOf })
}

const seeded = { portals: portalRows, links: linkRows }

describe('Portal Organization Export contributor', () => {
  it('emits exactly one CSV and one lossless JSON at a permitted classification', async () => {
    const contribution = await contribute(seeded)

    expect(contribution.context).toBe('portal')
    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    expect(contribution.entries.map(({ path, mediaType }) => [path, mediaType])).toEqual([
      ['portal/portals.csv', 'text/csv'],
      ['portal/portals.json', 'application/json'],
    ])
    for (const entry of contribution.entries) {
      expect(entry.path.startsWith('portal/')).toBe(true)
      expect(CLASSIFICATIONS_BY_CONTEXT.portal).toContain(entry.classification)
    }
  })

  it('orders rows by UTF-8 byte order regardless of the order the database returned', async () => {
    const forward = await contribute(seeded)
    const reversed = await contribute({
      portals: [...portalRows].reverse(),
      links: [...linkRows].reverse(),
    })

    expect(forward).toEqual(reversed)

    const payload = JSON.parse(
      Buffer.from(forward.entries[1]!.bytes).toString('utf8'),
    ) as Readonly<{
      portals: readonly Readonly<{ id: string }>[]
      links: readonly Readonly<{ sort_key: string }>[]
    }>
    expect(payload.portals.map(({ id }) => id)).toEqual([
      'a0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000002',
    ])
    expect(payload.links.map(({ sort_key }) => sort_key)).toEqual(['a', 'b'])
  })

  it('replays byte-identically for a fixed organization and asOf', async () => {
    const first = await contribute(seeded, SNAPSHOT_AT)
    // A later snapshot clock inside the same bounded window must not change a
    // single byte: nothing in the payload may be derived from wall time.
    const replay = await contribute(seeded, '2026-08-28T10:09:59.000000Z')

    for (const index of [0, 1]) {
      expect(Buffer.from(first.entries[index]!.bytes).toString('utf8')).toBe(
        Buffer.from(replay.entries[index]!.bytes).toString('utf8'),
      )
    }
  })

  it('answers no_data rather than shipping a header-only CSV', async () => {
    const contribution = await contribute({})

    expect(contribution).toEqual({
      context: 'portal',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(contribute(seeded, '2026-08-28T10:16:01.000000Z')).rejects.toThrow(
      /snapshot window is unavailable/u,
    )
  })

  it('survives the bundle builder beside sixteen stub contributors', async () => {
    const contributor = createPortalOrganizationExportContributor(
      fakeDatabase(seeded, SNAPSHOT_AT),
    )
    const bundle = await buildOrganizationExportBundle({
      organizationId: 'org-portal-export',
      requestId: 'req-1',
      asOf: ASOF,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'portal'
          ? contributor
          : {
              context,
              contribute: async () => ({
                context,
                coverage: 'no_data' as const,
                omissionCodes: [],
                entries: [],
              }),
            },
      ),
    })

    const contextEntries = bundle.entries.filter(({ path }) => path.startsWith('portal/'))
    expect(contextEntries.map(({ path }) => path)).toEqual([
      'portal/portals.csv',
      'portal/portals.json',
    ])
    expect(new Set(contextEntries.map(({ classification }) => classification))).toEqual(
      new Set(['tenant_visible']),
    )
  })

  it('stays composition input: no Portal server function, route or public API reaches it', () => {
    const contextFiles = sourceFiles(join(process.cwd(), 'src/contexts/portal'))
    const reachable = contextFiles
      .filter((path) => !path.endsWith('build.ts') && !path.includes('/adapters/'))
      .filter((path) => readFileSync(path, 'utf8').includes('organizationExport'))
      .map((path) => path.replace(`${process.cwd()}/`, ''))
    expect(reachable).toEqual([])

    const routes = sourceFiles(join(process.cwd(), 'src/routes')).filter((path) =>
      readFileSync(path, 'utf8').includes('organizationExportContributor'),
    )
    expect(routes).toEqual([])

    // The contributor is returned beside publicApi, never inside it.
    const build = readFileSync(
      join(process.cwd(), 'src/contexts/portal/build.ts'),
      'utf8',
    )
    expect(build).toContain(
      'organizationExportContributor: createPortalOrganizationExportContributor(deps.db)',
    )
  })
})
