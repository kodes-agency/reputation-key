import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  buildOrganizationExportBundle,
  CLASSIFICATIONS_BY_CONTEXT,
} from '#/contexts/identity/application/organization-export-contract'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'
import { createPropertyOrganizationExportContributor } from './property-organization-export.adapter'

type Row = Record<string, unknown>

/**
 * The adapter's determinism contract is about ordering and formatting, not
 * about Postgres, so the unit test drives it through a scripted executor and
 * leaves schema truth to the integration test beside it.
 */
function fakeDatabase(responses: readonly Row[][], snapshotAt: string): Database {
  const queue = [[{ snapshot_at: snapshotAt }], ...responses]
  const snapshot = {
    execute: async () => ({ rows: queue.shift() ?? [] }),
  }
  return {
    transaction: async (run: (executor: typeof snapshot) => Promise<unknown>) =>
      run(snapshot),
  } as unknown as Database
}

const ASOF = new Date('2026-08-28T10:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T10:00:30.000000Z'

const propertyRows: Row[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    name: 'Second, Hotel',
    slug: 'second',
    lifecycle_state: 'archived',
    created_at: '2026-01-02T00:00:00.000000Z',
    updated_at: '2026-01-02T00:00:00.000000Z',
    deleted_at: null,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'First Hotel',
    slug: 'first',
    lifecycle_state: 'active',
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    deleted_at: null,
  },
]

const managerRows: Row[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    property_id: 'a0000000-0000-4000-8000-000000000001',
    user_id: 'user-b',
    effective_from: '2026-02-01T00:00:00.000000Z',
    effective_to: null,
    created_by: 'user-a',
    end_reason: null,
  },
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    property_id: 'a0000000-0000-4000-8000-000000000001',
    user_id: 'user-a',
    effective_from: '2026-01-15T00:00:00.000000Z',
    effective_to: '2026-02-01T00:00:00.000000Z',
    created_by: 'user-a',
    end_reason: 'reassigned',
  },
]

function contribute(rows: readonly Row[][], snapshotAt = SNAPSHOT_AT, asOf = ASOF) {
  return createPropertyOrganizationExportContributor(
    fakeDatabase(rows, snapshotAt),
  ).contribute({ organizationId: 'org-property-export', requestId: 'req-1', asOf })
}

describe('Property Organization Export contributor', () => {
  it('emits exactly one CSV and one lossless JSON at a permitted classification', async () => {
    const contribution = await contribute([propertyRows, managerRows])

    expect(contribution.context).toBe('property')
    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    expect(contribution.entries.map(({ path, mediaType }) => [path, mediaType])).toEqual([
      ['property/properties.csv', 'text/csv'],
      ['property/properties.json', 'application/json'],
    ])
    for (const entry of contribution.entries) {
      expect(entry.path.startsWith('property/')).toBe(true)
      expect(CLASSIFICATIONS_BY_CONTEXT.property).toContain(entry.classification)
    }
  })

  it('orders rows by UTF-8 byte order regardless of the order the database returned', async () => {
    const forward = await contribute([propertyRows, managerRows])
    const reversed = await contribute([
      [...propertyRows].reverse(),
      [...managerRows].reverse(),
    ])

    expect(forward).toEqual(reversed)

    const payload = JSON.parse(
      Buffer.from(forward.entries[1]!.bytes).toString('utf8'),
    ) as Readonly<{
      properties: readonly Readonly<{ id: string }>[]
      responsibleManagers: readonly Readonly<{ id: string }>[]
    }>
    expect(payload.properties.map(({ id }) => id)).toEqual([
      'a0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000002',
    ])
    expect(payload.responsibleManagers.map(({ id }) => id)).toEqual([
      'c0000000-0000-4000-8000-000000000001',
      'c0000000-0000-4000-8000-000000000002',
    ])
  })

  it('replays byte-identically for a fixed organization and asOf', async () => {
    const first = await contribute([propertyRows, managerRows], SNAPSHOT_AT)
    // A later snapshot clock inside the same bounded window must not change a
    // single byte: nothing in the payload may be derived from wall time.
    const replay = await contribute(
      [propertyRows, managerRows],
      '2026-08-28T10:09:59.000000Z',
    )

    expect(Buffer.from(first.entries[0]!.bytes).toString('utf8')).toBe(
      Buffer.from(replay.entries[0]!.bytes).toString('utf8'),
    )
    expect(Buffer.from(first.entries[1]!.bytes).toString('utf8')).toBe(
      Buffer.from(replay.entries[1]!.bytes).toString('utf8'),
    )
  })

  it('answers no_data rather than shipping a header-only CSV', async () => {
    const contribution = await contribute([[], []])

    expect(contribution).toEqual({
      context: 'property',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(
      contribute([propertyRows, managerRows], '2026-08-28T10:16:01.000000Z'),
    ).rejects.toThrow(/snapshot window is unavailable/u)
  })

  it('survives the bundle builder beside sixteen stub contributors', async () => {
    const contributor = createPropertyOrganizationExportContributor(
      fakeDatabase([propertyRows, managerRows], SNAPSHOT_AT),
    )
    const bundle = await buildOrganizationExportBundle({
      organizationId: 'org-property-export',
      requestId: 'req-1',
      asOf: ASOF,
      contributors: ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) =>
        context === 'property'
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

    const contextEntries = bundle.entries.filter(({ path }) =>
      path.startsWith('property/'),
    )
    expect(contextEntries.map(({ path }) => path)).toEqual([
      'property/properties.csv',
      'property/properties.json',
    ])
    expect(new Set(contextEntries.map(({ classification }) => classification))).toEqual(
      new Set(['tenant_visible']),
    )
  })
})
