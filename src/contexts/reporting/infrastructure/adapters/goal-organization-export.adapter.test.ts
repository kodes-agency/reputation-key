import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createGoalOrganizationExportAdapter } from './goal-organization-export.adapter'

const AS_OF = new Date('2026-08-28T09:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T09:00:30.000Z'

type Row = Record<string, unknown>
type FixtureRows = Readonly<Record<string, readonly Row[]>>

const TABLE_MARKERS = [
  'goal_result_revisions',
  'goal_monthly_results',
  'goal_subject_assignments',
  'goal_program_versions',
  'goal_programs',
] as const

function queryText(query: SQL): string {
  const chunks = (query as unknown as { queryChunks: readonly unknown[] }).queryChunks
  return chunks
    .map((chunk) => {
      if (typeof chunk !== 'object' || chunk === null) return ' '
      // Nested `sql` fragments (the subject-kind allowlist) carry their own
      // chunks; flattening them keeps the assertion honest about what runs.
      if ('queryChunks' in chunk) return queryText(chunk as SQL)
      if (!('value' in chunk)) return ' '
      const { value } = chunk as { value: unknown }
      return Array.isArray(value) ? value.join('') : ' '
    })
    .join('')
}

function fakeDatabase(rows: FixtureRows, snapshotAt: string = SNAPSHOT_AT): Database {
  const snapshot = {
    execute: async (query: SQL) => {
      const text = queryText(query)
      if (text.includes('transaction_timestamp()')) {
        return { rows: [{ snapshot_at: snapshotAt }] }
      }
      const table = TABLE_MARKERS.find((marker) => text.includes(`FROM ${marker}`))
      if (!table) throw new Error(`unrouted goal export query: ${text}`)
      return { rows: rows[table] ?? [] }
    },
  }
  return {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(snapshot),
  } as unknown as Database
}

const PROGRAM_ROW: Row = {
  id: '40000000-0000-4000-8000-000000000001',
  property_id: '10000000-0000-4000-8000-000000000001',
  name: 'Gateway Program',
  description: null,
  status: 'active',
  status_reason: null,
  current_version: 1,
  created_by: 'user-1',
  created_at: '2026-08-01T00:00:00.000000Z',
  updated_at: '2026-08-01T00:00:00.000000Z',
}

function programVersionRow(id: string, metricKey: string, target: string): Row {
  return {
    id,
    program_id: PROGRAM_ROW.id,
    property_id: PROGRAM_ROW.property_id,
    version: 1,
    metric_definition_id: '11111111-1111-4111-8111-111111110301',
    metric_definition_version_id: '11111111-1111-4111-8111-111111111301',
    metric_key: metricKey,
    metric_minimum_sample: 0,
    target_value: target,
    property_timezone: 'UTC',
    effective_from: '2026-08-01T00:00:00.000000Z',
    effective_to: null,
    change_reason: 'initial',
    created_by: 'user-1',
    created_at: '2026-08-01T00:00:00.000000Z',
  }
}

function assignmentRow(id: string, subjectKind: string, metricKey: string): Row {
  return {
    id,
    program_id: PROGRAM_ROW.id,
    program_version_id: '50000000-0000-4000-8000-000000000001',
    property_id: PROGRAM_ROW.property_id,
    metric_key: metricKey,
    subject_kind: subjectKind,
    property_subject_id: subjectKind === 'property' ? PROGRAM_ROW.property_id : null,
    portal_group_id:
      subjectKind === 'portal_group' ? '60000000-0000-4000-8000-000000000001' : null,
    portal_id: subjectKind === 'portal' ? '70000000-0000-4000-8000-000000000001' : null,
    effective_from: '2026-08-01T00:00:00.000000Z',
    effective_to: null,
    created_by: 'user-1',
    created_at: '2026-08-01T00:00:00.000000Z',
  }
}

const FIXTURE: FixtureRows = {
  goal_programs: [PROGRAM_ROW],
  goal_program_versions: [
    programVersionRow('50000000-0000-4000-8000-000000000001', 'qualified_scans', '100'),
    programVersionRow(
      '50000000-0000-4000-8000-000000000002',
      'portal_rating_count',
      '25',
    ),
    programVersionRow(
      '50000000-0000-4000-8000-000000000003',
      'portal_rating_average',
      '4.5',
    ),
  ],
  goal_subject_assignments: [
    assignmentRow('80000000-0000-4000-8000-000000000001', 'portal', 'qualified_scans'),
    assignmentRow(
      '80000000-0000-4000-8000-000000000002',
      'portal_group',
      'portal_rating_count',
    ),
  ],
}

describe('Goal Organization Export contributor', () => {
  it('restricts the subject query to Property, Portal Group and Portal scopes', async () => {
    const seen: string[] = []
    const snapshot = {
      execute: async (query: SQL) => {
        const text = queryText(query)
        seen.push(text)
        if (text.includes('transaction_timestamp()')) {
          return { rows: [{ snapshot_at: SNAPSHOT_AT }] }
        }
        return { rows: [] }
      },
    }
    const db = {
      transaction: async (work: (tx: unknown) => Promise<unknown>) => work(snapshot),
    } as unknown as Database

    await createGoalOrganizationExportAdapter(db).contribute({
      organizationId: 'org-goal-export',
      requestId: 'a',
      asOf: AS_OF,
    })

    const subjectQuery = seen.find((text) =>
      text.includes('FROM goal_subject_assignments'),
    )
    // Person- and Team-scoped goals are prohibited by GOA-01; the archive must
    // not be the place such a row first becomes visible.
    expect(subjectQuery).toContain(
      "subject_kind IN ('property', 'portal_group', 'portal')",
    )
  })

  it('fails closed when the request is older than the bounded snapshot window', async () => {
    await expect(
      createGoalOrganizationExportAdapter(
        fakeDatabase(FIXTURE, '2026-08-28T09:16:01.000Z'),
      ).contribute({ organizationId: 'org-goal-export', requestId: 'a', asOf: AS_OF }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
