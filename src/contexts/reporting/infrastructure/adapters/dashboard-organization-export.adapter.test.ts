import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { CLASSIFICATIONS_BY_CONTEXT } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createDashboardOrganizationExportAdapter } from './dashboard-organization-export.adapter'

// Mirrors the rules `buildOrganizationExportBundle` enforces
// (identity/application/organization-export-contract.ts). They are restated
// here because a contributor test may only import the port; the end-to-end
// proof against the real builder lives in the full-composition task.
const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]{0,199}$/
const FORBIDDEN_PATH_COMPONENT =
  /(?:^|[/_.-])(?:oauth|secrets?|sessions?|cookies?|passwords?|hash(?:es)?|credentials?|tokens?|keys?|queues?|outbox(?:es)?|receipts?|rate.?limits?|fraud|security|prompts?|inferences?|operational.?actions?)(?=$|[/_.-])/iu

const AS_OF = new Date('2026-08-28T09:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T09:00:30.000Z'

type Row = Record<string, unknown>

function queryText(query: SQL): string {
  const chunks = (query as unknown as { queryChunks: readonly unknown[] }).queryChunks
  return chunks
    .map((chunk) => {
      if (typeof chunk !== 'object' || chunk === null || !('value' in chunk)) return ' '
      const { value } = chunk as { value: unknown }
      return Array.isArray(value) ? value.join('') : ' '
    })
    .join('')
}

function fakeDatabase(
  milestones: readonly Row[],
  snapshotAt: string = SNAPSHOT_AT,
): Database {
  const snapshot = {
    execute: async (query: SQL) => {
      const text = queryText(query)
      if (text.includes('transaction_timestamp()')) {
        return { rows: [{ snapshot_at: snapshotAt }] }
      }
      if (text.includes('FROM setup_checklist_milestones')) return { rows: milestones }
      throw new Error(`unrouted dashboard export query: ${text}`)
    },
  }
  return {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(snapshot),
  } as unknown as Database
}

const MILESTONES: readonly Row[] = [
  {
    step: 'google_connection',
    first_completed_at: '2026-08-01T10:00:00.000000Z',
    created_at: '2026-08-01T10:00:00.000000Z',
  },
  {
    step: 'published_portal',
    first_completed_at: '2026-08-03T10:00:00.000000Z',
    created_at: '2026-08-03T10:00:00.000000Z',
  },
]

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8')
}

describe('Dashboard Organization Export contributor', () => {
  it('exports the owned onboarding milestones with a permitted classification', async () => {
    const adapter = createDashboardOrganizationExportAdapter(fakeDatabase(MILESTONES))
    expect(adapter.context).toBe('dashboard')

    const contribution = await adapter.contribute({
      organizationId: 'org-dashboard-export',
      requestId: 'request-1',
      asOf: AS_OF,
    })

    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    expect(contribution.entries.map(({ path, mediaType }) => [path, mediaType])).toEqual([
      ['dashboard/setup-checklist.csv', 'text/csv'],
      ['dashboard/setup-checklist.json', 'application/json'],
    ])
    for (const entry of contribution.entries) {
      expect(entry.path.startsWith('dashboard/')).toBe(true)
      expect(SAFE_PATH.test(entry.path)).toBe(true)
      expect(FORBIDDEN_PATH_COMPONENT.test(entry.path)).toBe(false)
      expect(CLASSIFICATIONS_BY_CONTEXT.dashboard).toContain(entry.classification)
      expect(entry.bytes.byteLength).toBeGreaterThan(0)
    }

    const csv = decode(contribution.entries[0]!.bytes)
    expect(csv).toBe(
      [
        'record_type,step,first_completed_at,created_at',
        'setup_checklist_milestone,google_connection,2026-08-01T10:00:00.000000Z,2026-08-01T10:00:00.000000Z',
        'setup_checklist_milestone,published_portal,2026-08-03T10:00:00.000000Z,2026-08-03T10:00:00.000000Z',
        '',
      ].join('\n'),
    )
  })

  it('duplicates no Metric or Review row under a second dashboard path', async () => {
    const contribution = await createDashboardOrganizationExportAdapter(
      fakeDatabase(MILESTONES),
    ).contribute({ organizationId: 'org-dashboard-export', requestId: 'a', asOf: AS_OF })

    const json = JSON.parse(decode(contribution.entries[1]!.bytes)) as Record<
      string,
      unknown
    >
    expect(Object.keys(json.records as Record<string, unknown>)).toEqual([
      'setup_checklist_milestone',
    ])
    expect(json.excludedRecordClasses).toEqual([
      {
        recordClass: 'metric_and_review_read_projections',
        reasonCode: 'owned_and_exported_by_the_source_context',
      },
      {
        recordClass: 'attention_and_fleet_overview_derivations',
        reasonCode: 'derived_read_surface_without_durable_rows',
      },
    ])
  })

  it('produces byte-identical output for a repeated request at the same asOf', async () => {
    const first = await createDashboardOrganizationExportAdapter(
      fakeDatabase(MILESTONES, '2026-08-28T09:00:05.000Z'),
    ).contribute({ organizationId: 'org-dashboard-export', requestId: 'a', asOf: AS_OF })
    const replay = await createDashboardOrganizationExportAdapter(
      fakeDatabase(MILESTONES, '2026-08-28T09:10:00.000Z'),
    ).contribute({ organizationId: 'org-dashboard-export', requestId: 'b', asOf: AS_OF })

    expect(first.entries.map(({ bytes }) => decode(bytes))).toEqual(
      replay.entries.map(({ bytes }) => decode(bytes)),
    )
  })

  it('answers no_data affirmatively when the Organization completed no milestone', async () => {
    const contribution = await createDashboardOrganizationExportAdapter(
      fakeDatabase([]),
    ).contribute({ organizationId: 'org-dashboard-export', requestId: 'a', asOf: AS_OF })

    expect(contribution).toEqual({
      context: 'dashboard',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(
      createDashboardOrganizationExportAdapter(
        fakeDatabase(MILESTONES, '2026-08-28T09:16:01.000Z'),
      ).contribute({
        organizationId: 'org-dashboard-export',
        requestId: 'a',
        asOf: AS_OF,
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
