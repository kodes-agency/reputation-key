import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
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
  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(contribute(seeded, '2026-08-28T10:16:01.000000Z')).rejects.toThrow(
      /snapshot window is unavailable/u,
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
