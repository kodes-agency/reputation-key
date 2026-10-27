import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createPortalOrganizationExportContributor } from './portal-organization-export.adapter'

type Row = Record<string, unknown>

/** The exact order readPayload queries its collections after the clock. */
const READ_ORDER = [
  'portals',
  'portalGroups',
  'portalGroupHistory',
  'linkCategories',
  'links',
  'linkTexts',
  'mediaAssets',
  'approvedDestinations',
  'localizedOverrides',
  'brandProfiles',
  'brandContents',
  'portalLookOverrides',
  'publicationSnapshots',
  'publicationActivations',
  'pendingContentChanges',
  'pageEdits',
  'responsibleManagers',
  'accessArtifacts',
  'addressDownloads',
  'healthIntervals',
  'lastPrints',
  'printWordings',
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

/** Two Portals' own looks, given out of order: the later Portal first. */
const lookOverrideRows: Row[] = [
  {
    id: 'e0000000-0000-4000-8000-000000000002',
    property_id: 'p0000000-0000-4000-8000-000000000001',
    portal_id: 'b0000000-0000-4000-8000-000000000002',
    photo_mode: 'own',
    hero_asset_id: 'f0000000-0000-4000-8000-000000000001',
    hero_focal_x: 0.25,
    hero_focal_y: 0.75,
    hero_alt_texts: '{"bg": "Спа", "en": "The spa"}',
    colours_mode: 'own',
    primary_color: '#B8860B',
    background_mode: 'auto',
    background_color: '#101820',
    identity_mode: 'inherit',
    wordmark: null,
    logo_asset_id: null,
    look_version: 5,
    updated_by: 'user-admin',
    created_at: '2026-02-02T00:00:00.000000Z',
    updated_at: '2026-02-03T00:00:00.000000Z',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000001',
    property_id: 'p0000000-0000-4000-8000-000000000001',
    portal_id: 'a0000000-0000-4000-8000-000000000001',
    photo_mode: 'none',
    hero_asset_id: null,
    hero_focal_x: null,
    hero_focal_y: null,
    hero_alt_texts: '{}',
    colours_mode: 'inherit',
    primary_color: null,
    background_mode: null,
    background_color: null,
    identity_mode: 'own',
    wordmark: 'FRONT',
    logo_asset_id: null,
    look_version: 3,
    updated_by: 'user-admin',
    created_at: '2026-02-01T00:00:00.000000Z',
    updated_at: '2026-02-01T00:00:00.000000Z',
  },
]

const payloadOf = (contribution: Awaited<ReturnType<typeof contribute>>) => {
  const json = contribution.entries.find(
    ({ mediaType }) => mediaType === 'application/json',
  )
  return JSON.parse(
    Buffer.from(json?.bytes ?? new Uint8Array()).toString('utf8'),
  ) as Record<string, readonly Row[]>
}

/** The text of every statement the adapter runs after its clock, in order. */
async function statementsOf(): Promise<string[]> {
  const statements: string[] = []
  const dialect = new PgDialect()
  const snapshot = {
    execute: async (query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql)
      return { rows: statements.length === 1 ? [{ snapshot_at: SNAPSHOT_AT }] : [] }
    },
  }
  const database = {
    transaction: async (run: (executor: typeof snapshot) => Promise<unknown>) =>
      run(snapshot),
  } as unknown as Database
  await createPortalOrganizationExportContributor(database).contribute({
    organizationId: 'org-portal-export',
    requestId: 'req-1',
    asOf: ASOF,
  })
  return statements.slice(1)
}

const tableOf = (statement: string) =>
  /\bFROM\s+([a-z_]+)/u.exec(statement.replace(/\s+/gu, ' '))?.[1]

describe('Portal Organization Export contributor', () => {
  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(contribute(seeded, '2026-08-28T10:16:01.000000Z')).rejects.toThrow(
      /snapshot window is unavailable/u,
    )
  })

  it('reads nothing from the retired portal_group_members compatibility mirror', async () => {
    const statements: string[] = []
    const dialect = new PgDialect()
    const snapshot = {
      execute: async (query: SQL) => {
        statements.push(dialect.sqlToQuery(query).sql)
        return { rows: statements.length === 1 ? [{ snapshot_at: SNAPSHOT_AT }] : [] }
      },
    }
    const database = {
      transaction: async (run: (executor: typeof snapshot) => Promise<unknown>) =>
        run(snapshot),
    } as unknown as Database

    await createPortalOrganizationExportContributor(database).contribute({
      organizationId: 'org-portal-export',
      requestId: 'req-1',
      asOf: ASOF,
    })

    expect(statements.length).toBeGreaterThan(10)
    expect(statements.filter((text) => text.includes('portal_group_members'))).toEqual([])
  })

  it('exports each Portal’s own look, ordered by Portal, beside the Property look', async () => {
    const contribution = await contribute({
      ...seeded,
      portalLookOverrides: lookOverrideRows,
    })

    expect(contribution.coverage).toBe('complete')
    const payload = payloadOf(contribution)
    expect(payload.portalLookOverrides?.map((row) => row.portal_id)).toEqual([
      'a0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000002',
    ])
    // The own photo's descriptions travel with it, as the text Postgres renders.
    expect(payload.portalLookOverrides?.[1]).toMatchObject({
      photo_mode: 'own',
      hero_alt_texts: '{"bg": "Спа", "en": "The spa"}',
      primary_color: '#B8860B',
      look_version: 5,
    })

    const csv = Buffer.from(contribution.entries[0]?.bytes ?? new Uint8Array())
      .toString('utf8')
      .split('\n')
    const lookLines = csv.filter((line) => line.startsWith('portal_look_override,'))
    expect(lookLines).toHaveLength(2)
    // A Portal's own look belongs to a Portal: its id is in the portal_id column.
    expect(lookLines.map((line) => line.split(',')[3])).toEqual([
      'a0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000002',
    ])
    // The summary lists them after the Portals and the links they belong to.
    const types = csv.map((line) => line.split(',')[0])
    expect(types.indexOf('portal_look_override')).toBeGreaterThan(
      types.lastIndexOf('portal_link'),
    )
  })

  it('reads the own looks right after the Property’s wording, by name, scoped to the Organization', async () => {
    const statements = (await statementsOf()).map((text) => text.replace(/\s+/gu, ' '))
    const tables = statements.map(tableOf)
    const from = tables.indexOf('property_portal_brand_contents')
    expect(tables.slice(from, from + 3)).toEqual([
      'property_portal_brand_contents',
      'portal_look_overrides',
      'portal_publication_snapshots',
    ])

    const statement = statements[tables.indexOf('portal_look_overrides')] ?? ''
    // Named columns, never `*`: a column added later is a decision about export.
    expect(statement).not.toMatch(/SELECT \*/u)
    expect(statement).toContain('hero_alt_texts::text AS hero_alt_texts')
    expect(statement).toContain('photo_mode, ')
    expect(statement).toMatch(/WHERE organization_id = \$1$/u)
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

    // Built once, by the composition-owned contributor set, never by a build.
    const build = readFileSync(
      join(process.cwd(), 'src/contexts/portal/build.ts'),
      'utf8',
    )
    expect(build).not.toContain('createPortalOrganizationExportContributor')
    expect(
      readFileSync(
        join(process.cwd(), 'src/composition/organization-export-contributors.ts'),
        'utf8',
      ),
    ).toContain('createPortalOrganizationExportContributor(db)')
  })
})
