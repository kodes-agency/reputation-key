import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  buildOrganizationExportBundle,
  CLASSIFICATIONS_BY_CONTEXT,
} from '#/contexts/identity/application/organization-export-contract'
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
  it('separates de-identified facts, legacy rows, and guest-authored text by classification', async () => {
    const contribution = await contribute(seeded)

    expect(contribution.context).toBe('guest')
    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    expect(
      contribution.entries.map(({ path, mediaType, classification }) => [
        path,
        mediaType,
        classification,
      ]),
    ).toEqual([
      ['guest/responses.csv', 'text/csv', 'tenant_visible'],
      ['guest/responses.json', 'application/json', 'tenant_visible'],
      ['guest/legacy-responses.csv', 'text/csv', 'tenant_visible'],
      ['guest/legacy-responses.json', 'application/json', 'tenant_visible'],
      ['guest/private-feedback.csv', 'text/csv', 'permitted_guest_content'],
      ['guest/private-feedback.json', 'application/json', 'permitted_guest_content'],
    ])
    for (const entry of contribution.entries) {
      expect(entry.path.startsWith('guest/')).toBe(true)
      expect(CLASSIFICATIONS_BY_CONTEXT.guest).toContain(entry.classification)
    }
  })

  it('keeps guest-authored text out of the tenant-visible fact files', async () => {
    const contribution = await contribute(seeded)
    const factText = contribution.entries
      .filter(({ classification }) => classification === 'tenant_visible')
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')

    expect(factText).not.toContain('room" was cold')
    expect(factText).toContain('not_provided')
  })

  it('orders rows by UTF-8 byte order regardless of the order the database returned', async () => {
    const forward = await contribute(seeded)
    const reversed = await contribute({
      ...seeded,
      responses: [...responseRows].reverse(),
    })

    expect(forward).toEqual(reversed)

    const payload = JSON.parse(
      Buffer.from(forward.entries[1]!.bytes).toString('utf8'),
    ) as Readonly<{ responses: readonly Readonly<{ id: string }>[] }>
    expect(payload.responses.map(({ id }) => id)).toEqual([
      'a0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000002',
    ])
  })

  it('replays byte-identically for a fixed organization and asOf', async () => {
    const first = await contribute(seeded, SNAPSHOT_AT)
    // A later snapshot clock inside the same bounded window must not change a
    // single byte: nothing in the payload may be derived from wall time.
    const replay = await contribute(seeded, '2026-08-28T10:09:59.000000Z')

    expect(first.entries.map(({ bytes }) => Buffer.from(bytes).toString('utf8'))).toEqual(
      replay.entries.map(({ bytes }) => Buffer.from(bytes).toString('utf8')),
    )
  })

  it('emits only the families that have rows', async () => {
    const contribution = await contribute({ responses: responseRows })

    expect(contribution.entries.map(({ path }) => path)).toEqual([
      'guest/responses.csv',
      'guest/responses.json',
    ])
  })

  it('answers no_data rather than shipping a header-only CSV', async () => {
    const contribution = await contribute({})

    expect(contribution).toEqual({
      context: 'guest',
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
    const contributor = createGuestOrganizationExportContributor(
      fakeDatabase(seeded, SNAPSHOT_AT),
    )
    const bundle = await buildOrganizationExportBundle({
      organizationId: 'org-guest-export',
      requestId: 'req-1',
      asOf: ASOF,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'guest' ? contributor : stub(context),
      ),
    })

    expect(
      bundle.entries
        .filter(({ path }) => path.startsWith('guest/'))
        .map(({ path }) => path),
    ).toEqual([
      'guest/legacy-responses.csv',
      'guest/legacy-responses.json',
      'guest/private-feedback.csv',
      'guest/private-feedback.json',
      'guest/responses.csv',
      'guest/responses.json',
    ])
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
