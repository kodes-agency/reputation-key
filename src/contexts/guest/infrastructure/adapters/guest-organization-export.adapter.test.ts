import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { buildOrganizationExportBundle } from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createGuestOrganizationExportContributor } from './guest-organization-export.adapter'

type Row = Record<string, unknown>

/** The exact order readPayload queries its collections after the clock. */
const READ_ORDER = [
  'responses',
  'qualifiedScans',
  'integrityDecisions',
  'experienceSnapshots',
  'privateFeedback',
  'legacyRatings',
  'legacyFeedbackFacts',
  'legacyFeedbackText',
  'legacyScanEvents',
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

const responseRows: Row[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    portal_id: 'f0000000-0000-4000-8000-000000000001',
    status: 'submitted',
    rating: 2,
    private_feedback_state: 'available',
    submitted_at: '2026-01-02T00:00:00.000000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    portal_id: 'f0000000-0000-4000-8000-000000000001',
    status: 'submitted',
    rating: 5,
    private_feedback_state: 'not_provided',
    submitted_at: '2026-01-01T00:00:00.000000Z',
  },
]

const privateFeedbackRows: Row[] = [
  {
    response_id: 'b0000000-0000-4000-8000-000000000002',
    portal_id: 'f0000000-0000-4000-8000-000000000001',
    body: 'The, "room" was cold\nbut the staff were kind',
    submitted_at: '2026-01-02T00:00:00.000000Z',
    expires_at: '2026-04-02T00:00:00.000000Z',
  },
]

const legacyRatingRows: Row[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    portal_id: 'f0000000-0000-4000-8000-000000000001',
    value: 4,
    source: 'qr',
    created_at: '2025-06-01T00:00:00.000000Z',
  },
]

const seeded = {
  responses: responseRows,
  privateFeedback: privateFeedbackRows,
  legacyRatings: legacyRatingRows,
}

function contribute(
  rows: Readonly<Partial<Record<Collection, Row[]>>>,
  snapshotAt = SNAPSHOT_AT,
  asOf = ASOF,
) {
  return createGuestOrganizationExportContributor(
    fakeDatabase(rows, snapshotAt),
  ).contribute({ organizationId: 'org-guest-export', requestId: 'req-1', asOf })
}

describe('Guest Organization Export contributor', () => {
  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(contribute(seeded, '2026-08-28T10:16:01.000000Z')).rejects.toThrow(
      /snapshot window is unavailable/u,
    )
  })

  it('rejects a Guest entry tagged with a classification Guest may not use', async () => {
    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-guest-export',
        requestId: 'req-1',
        asOf: ASOF,
        contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
          context === 'guest'
            ? {
                context,
                contribute: async () => ({
                  context,
                  coverage: 'complete' as const,
                  omissionCodes: [],
                  entries: [
                    {
                      path: 'guest/responses.csv',
                      mediaType: 'text/csv' as const,
                      classification: 'manager_authored' as const,
                      bytes: Buffer.from('record_type\n', 'utf8'),
                    },
                    {
                      path: 'guest/responses.json',
                      mediaType: 'application/json' as const,
                      classification: 'tenant_visible' as const,
                      bytes: Buffer.from('{}\n', 'utf8'),
                    },
                  ],
                }),
              }
            : stub(context),
        ),
      }),
    ).rejects.toThrow(/classification is not permitted for guest/u)
  })

  it('stays composition input: no Guest server function, route or public API reaches it', () => {
    const contextFiles = sourceFiles(join(process.cwd(), 'src/contexts/guest'))
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
    const build = readFileSync(join(process.cwd(), 'src/contexts/guest/build.ts'), 'utf8')
    expect(build).toContain(
      'organizationExportContributor: createGuestOrganizationExportContributor(deps.db)',
    )
  })
})

function stub(context: (typeof ORGANIZATION_LIFECYCLE_CONTEXTS)[number]) {
  return {
    context,
    contribute: async () => ({
      context,
      coverage: 'no_data' as const,
      omissionCodes: [],
      entries: [],
    }),
  }
}
