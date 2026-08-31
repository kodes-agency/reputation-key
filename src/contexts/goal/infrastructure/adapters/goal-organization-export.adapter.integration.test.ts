import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { CLASSIFICATIONS_BY_CONTEXT } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createGoalOrganizationExportAdapter } from './goal-organization-export.adapter'

// Immutable registry ids seeded by migration 0018 (METRIC_VERSION_IDS).
const RATING_COUNT_DEFINITION = '11111111-1111-4111-8111-111111110302'
const RATING_COUNT_VERSION = '11111111-1111-4111-8111-111111111302'
const QUALIFIED_SCAN_DEFINITION = '11111111-1111-4111-8111-111111110301'
const QUALIFIED_SCAN_VERSION = '11111111-1111-4111-8111-111111111301'
const RATING_AVERAGE_DEFINITION = '11111111-1111-4111-8111-111111110303'
const RATING_AVERAGE_VERSION = '11111111-1111-4111-8111-111111111303'

const APPEND_ONLY_GUARDS = [
  { table: 'goal_result_revisions', name: 'goal_result_revisions_append_only' },
  { table: 'goal_monthly_results', name: 'goal_monthly_results_guard' },
  { table: 'goal_program_versions', name: 'goal_program_versions_append_only' },
  { table: 'goal_evaluations', name: 'goal_evaluations_immutable' },
  { table: 'goal_definition_versions', name: 'goal_definition_versions_immutable' },
] as const

const organizations = new Set<string>()
let lease: TestLease
let db: Database

type ProgramFixture = Readonly<{
  programId: string
  versionId: string
  assignmentId: string
}>

type Fixture = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  portalGroupId: string
  scanProgram: ProgramFixture
  ratingCountProgram: ProgramFixture
  ratingAverageProgram: ProgramFixture
  monthlyResultId: string
  revisionId: string
  legacyGoalId: string
  definitionId: string
  definitionVersionId: string
  periodId: string
  evaluationId: string
  receiptMarker: string
}>

async function seedOrganization(prefix: string): Promise<string> {
  const organizationId = `${prefix}-${randomUUID()}`
  organizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Goal Export Fixture', $1, NOW())`,
    [organizationId],
  )
  return organizationId
}

function programFixture(): ProgramFixture {
  return {
    programId: randomUUID(),
    versionId: randomUUID(),
    assignmentId: randomUUID(),
  }
}

async function seedProgram(
  fixture: Fixture,
  program: ProgramFixture,
  metric: Readonly<{
    key: string
    definitionId: string
    versionId: string
    minimumSample: number
    target: string
  }>,
  subject: Readonly<{ kind: string; portalId: string | null; groupId: string | null }>,
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO goal_programs (
       id, organization_id, property_id, name, status, current_version,
       created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', 1, 'user-goal-export',
               TIMESTAMPTZ '2026-08-01T00:00:00Z', TIMESTAMPTZ '2026-08-01T00:00:00Z')`,
    [
      program.programId,
      fixture.organizationId,
      fixture.propertyId,
      `Program ${metric.key}`,
    ],
  )
  await lease.pool.query(
    `INSERT INTO goal_program_versions (
       id, program_id, organization_id, property_id, version,
       metric_definition_id, metric_definition_version_id, metric_key,
       metric_minimum_sample, target_value, property_timezone, effective_from,
       change_reason, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9::numeric, 'UTC',
               TIMESTAMPTZ '2026-01-01T00:00:00Z', 'initial', 'user-goal-export',
               TIMESTAMPTZ '2026-08-01T00:00:00Z')`,
    [
      program.versionId,
      program.programId,
      fixture.organizationId,
      fixture.propertyId,
      metric.definitionId,
      metric.versionId,
      metric.key,
      metric.minimumSample,
      metric.target,
    ],
  )
  await lease.pool.query(
    `INSERT INTO goal_subject_assignments (
       id, program_id, program_version_id, organization_id, property_id,
       metric_key, subject_kind, property_subject_id, portal_group_id, portal_id,
       effective_from, created_by, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               TIMESTAMPTZ '2026-01-01T00:00:00Z', 'user-goal-export',
               TIMESTAMPTZ '2026-08-01T00:00:00Z')`,
    [
      program.assignmentId,
      program.programId,
      program.versionId,
      fixture.organizationId,
      fixture.propertyId,
      metric.key,
      subject.kind,
      subject.kind === 'property' ? fixture.propertyId : null,
      subject.groupId,
      subject.portalId,
    ],
  )
}

async function seedFixture(): Promise<Fixture> {
  const organizationId = await seedOrganization('goal-export-org')
  const fixture: Fixture = {
    organizationId,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    portalGroupId: randomUUID(),
    scanProgram: programFixture(),
    ratingCountProgram: programFixture(),
    ratingAverageProgram: programFixture(),
    monthlyResultId: randomUUID(),
    revisionId: randomUUID(),
    legacyGoalId: randomUUID(),
    definitionId: randomUUID(),
    definitionVersionId: randomUUID(),
    periodId: randomUUID(),
    evaluationId: randomUUID(),
    receiptMarker: `NEVER-EXPORT-RECEIPT-${randomUUID()}`,
  }

  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Goal Export Property', $1::text, 'UTC', NOW(), NOW())`,
    [fixture.propertyId, organizationId],
  )
  await lease.pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       created_at, updated_at
     ) VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text, 'Goal Export Portal',
               $1::text, NOW(), NOW())`,
    [fixture.portalId, organizationId, fixture.propertyId],
  )
  await lease.pool.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Goal Export Group', NOW(), NOW())`,
    [fixture.portalGroupId, organizationId, fixture.propertyId],
  )

  // The three governed measures, at Portal, Portal Group, and Property scope.
  // A Portal may be ungrouped, so both Portal and Portal Group must appear.
  await seedProgram(
    fixture,
    fixture.scanProgram,
    {
      key: 'qualified_scans',
      definitionId: QUALIFIED_SCAN_DEFINITION,
      versionId: QUALIFIED_SCAN_VERSION,
      minimumSample: 0,
      target: '100',
    },
    { kind: 'portal', portalId: fixture.portalId, groupId: null },
  )
  await seedProgram(
    fixture,
    fixture.ratingCountProgram,
    {
      key: 'portal_rating_count',
      definitionId: RATING_COUNT_DEFINITION,
      versionId: RATING_COUNT_VERSION,
      minimumSample: 0,
      target: '25',
    },
    { kind: 'portal_group', portalId: null, groupId: fixture.portalGroupId },
  )
  await seedProgram(
    fixture,
    fixture.ratingAverageProgram,
    {
      key: 'portal_rating_average',
      definitionId: RATING_AVERAGE_DEFINITION,
      versionId: RATING_AVERAGE_VERSION,
      minimumSample: 10,
      target: '4.5',
    },
    { kind: 'property', portalId: null, groupId: null },
  )

  await lease.pool.query(
    `INSERT INTO goal_monthly_results (
       id, assignment_id, program_id, program_version_id, organization_id,
       property_id, period_start, period_end, property_timezone, status,
       evaluation_state, value, sample_count, achieved, source_complete_through,
       evaluation_watermark, closed_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6,
               TIMESTAMPTZ '2026-06-01T00:00:00Z', TIMESTAMPTZ '2026-07-01T00:00:00Z',
               'UTC', 'closed', 'eligible', 30, 30, false,
               TIMESTAMPTZ '2026-07-01T00:00:00Z', TIMESTAMPTZ '2026-07-02T00:00:00Z',
               TIMESTAMPTZ '2026-07-02T00:00:00Z', NOW(), NOW())`,
    [
      fixture.monthlyResultId,
      fixture.scanProgram.assignmentId,
      fixture.scanProgram.programId,
      fixture.scanProgram.versionId,
      organizationId,
      fixture.propertyId,
    ],
  )
  await lease.pool.query(
    `INSERT INTO goal_result_revisions (
       id, monthly_result_id, organization_id, property_id, revision,
       evaluation_state, value, sample_count, achieved, source_complete_through,
       evaluation_watermark, change_reason, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, 'eligible', 30, 30, false,
               TIMESTAMPTZ '2026-07-01T00:00:00Z', TIMESTAMPTZ '2026-07-02T00:00:00Z',
               'metric correction reconciled', 'user-goal-export', NOW())`,
    [fixture.revisionId, fixture.monthlyResultId, organizationId, fixture.propertyId],
  )

  // Legacy pre-beta family, still tenant-authored configuration.
  await lease.pool.query(
    `INSERT INTO goals (
       id, organization_id, property_id, portal_id, name, created_by, goal_type,
       aggregation_function, metric_key, target_value, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'Legacy Goal', 'user-goal-export', 'target', 'sum',
               'portal.rating_count', 10, 'active', NOW(), NOW())`,
    [fixture.legacyGoalId, organizationId, fixture.propertyId, fixture.portalId],
  )
  await lease.pool.query(
    `INSERT INTO goal_progress (
       goal_id, organization_id, current_value, current_sum, current_count,
       last_computed_at, computed_source
     ) VALUES ($1, $2, 4, 4, 4, TIMESTAMPTZ '2026-08-27T00:00:00Z', 'metric')`,
    [fixture.legacyGoalId, organizationId],
  )

  // Governed definition family with a Portal Group scope, one period, and one
  // evaluation bound to it.
  await lease.pool.query(
    `INSERT INTO goal_definitions (
       id, organization_id, property_id, scope_kind, portal_group_id, name,
       status, current_version, created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, 'portal_group', $4, 'Group Definition', 'active', 1,
               'user-goal-export', NOW(), NOW())`,
    [fixture.definitionId, organizationId, fixture.propertyId, fixture.portalGroupId],
  )
  await lease.pool.query(
    `INSERT INTO goal_definition_versions (
       id, definition_id, organization_id, property_id, version,
       metric_definition_id, metric_definition_version_id, metric_key,
       metric_value_kind, metric_minimum_sample, metric_allowed_scopes,
       metric_permitted_consumers, measure_kind, target_value, source_policy,
       property_timezone, recurrence_rule, effective_from, change_reason,
       created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'portal.rating_count', 'counter', 1,
               '["portal_group"]'::jsonb, '["goal"]'::jsonb, 'progress', 25,
               'first_party_guest_gateway_metric', 'UTC',
               '{"frequency":"monthly","interval":1}'::jsonb,
               TIMESTAMPTZ '2026-08-01T00:00:00Z', 'initial', 'user-goal-export', NOW())`,
    [
      fixture.definitionVersionId,
      fixture.definitionId,
      organizationId,
      fixture.propertyId,
      RATING_COUNT_DEFINITION,
      RATING_COUNT_VERSION,
    ],
  )
  await lease.pool.query(
    `INSERT INTO goal_periods (
       id, definition_id, definition_version_id, organization_id, property_id,
       period_start, period_end, property_timezone, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-01T00:00:00Z',
               TIMESTAMPTZ '2026-09-01T00:00:00Z', 'UTC', 'open', NOW(), NOW())`,
    [
      fixture.periodId,
      fixture.definitionId,
      fixture.definitionVersionId,
      organizationId,
      fixture.propertyId,
    ],
  )
  await lease.pool.query(
    `INSERT INTO goal_evaluations (
       id, period_id, definition_id, definition_version_id, organization_id,
       property_id, idempotency_key, state, value, sample_count, achieved,
       evaluation_watermark, created_by, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'eligible', 12, 12, false,
               TIMESTAMPTZ '2026-08-27T00:00:00Z', 'user-goal-export', NOW())`,
    [
      fixture.evaluationId,
      fixture.periodId,
      fixture.definitionId,
      fixture.definitionVersionId,
      organizationId,
      fixture.propertyId,
      `${fixture.receiptMarker}-idempotency`,
    ],
  )

  // Idempotency receipts: content-free control plane the archive must not reach.
  await lease.pool.query(
    `INSERT INTO goal_refresh_receipts (
       source_event_id, period_id, organization_id, property_id, evaluation_id
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      `${fixture.receiptMarker}-refresh`,
      fixture.periodId,
      organizationId,
      fixture.propertyId,
      fixture.evaluationId,
    ],
  )
  await lease.pool.query(
    `INSERT INTO goal_timezone_event_receipts (
       source_event_id, definition_id, organization_id, property_id,
       property_version, new_definition_version_id, new_period_id
     ) VALUES ($1, $2, $3, $4, 1, $5, $6)`,
    [
      `${fixture.receiptMarker}-timezone`,
      fixture.definitionId,
      organizationId,
      fixture.propertyId,
      fixture.definitionVersionId,
      fixture.periodId,
    ],
  )

  return fixture
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8')
}

function records(
  entries: readonly { path: string; bytes: Uint8Array }[],
  path: string,
  recordType: string,
): readonly Record<string, unknown>[] {
  const payload = JSON.parse(
    decode(entries.find((entry) => entry.path === path)!.bytes),
  ) as { records: Record<string, readonly Record<string, unknown>[]> }
  return payload.records[recordType]!
}

describe.sequential('Goal Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    const ids = [...organizations]
    // Production append-only/immutability guards are exactly what a fixture
    // cleanup has to step around; they stay enabled for every insert above.
    for (const guard of APPEND_ONLY_GUARDS) {
      await lease.pool.query(`ALTER TABLE ${guard.table} DISABLE TRIGGER ${guard.name}`)
    }
    for (const table of [
      'goal_refresh_receipts',
      'goal_timezone_event_receipts',
      'goal_result_revisions',
      'goal_monthly_results',
      'goal_subject_assignments',
      'goal_program_versions',
      'goal_programs',
      'goal_evaluations',
      'goal_periods',
      'goal_definition_versions',
      'goal_definitions',
      'goal_progress',
      'goals',
      'portal_groups',
      'portals',
      'properties',
    ]) {
      await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        ids,
      ])
    }
    await deleteTestOrganizations(lease.pool, ids)
    for (const guard of APPEND_ONLY_GUARDS) {
      await lease.pool.query(`ALTER TABLE ${guard.table} ENABLE TRIGGER ${guard.name}`)
    }
    organizations.clear()
  })

  it('exports every Goal family deterministically without idempotency receipts', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createGoalOrganizationExportAdapter(db)

    const first = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      context: 'goal',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(first.entries.map(({ path }) => path)).toEqual([
      'goal/definitions.csv',
      'goal/definitions.json',
      'goal/goals.csv',
      'goal/goals.json',
      'goal/periods.csv',
      'goal/periods.json',
      'goal/programs.csv',
      'goal/programs.json',
      'goal/results.csv',
      'goal/results.json',
      'goal/subject-assignments.csv',
      'goal/subject-assignments.json',
    ])
    for (const entry of first.entries) {
      expect(CLASSIFICATIONS_BY_CONTEXT.goal).toContain(entry.classification)
    }

    const archiveText = first.entries.map(({ bytes }) => decode(bytes)).join('\n')
    expect(archiveText).not.toContain('NEVER-EXPORT-RECEIPT-')
  })

  it('exports all three measures at Portal, Portal Group and Property scope', async () => {
    const fixture = await seedFixture()
    const contribution = await createGoalOrganizationExportAdapter(db).contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    const versions = records(
      contribution.entries,
      'goal/programs.json',
      'goal_program_version',
    )
    expect([...versions.map((version) => version.metric_key)].sort()).toEqual([
      'portal_rating_average',
      'portal_rating_count',
      'qualified_scans',
    ])
    for (const version of versions) {
      // Program intervals travel with the measure: a target without its
      // effective interval cannot be reconciled to a period.
      expect(version.effective_from).toBe('2026-01-01T00:00:00.000000Z')
      expect(version.effective_to).toBeNull()
      expect(version.property_timezone).toBe('UTC')
    }

    const assignments = records(
      contribution.entries,
      'goal/subject-assignments.json',
      'goal_subject_assignment',
    )
    expect([...assignments.map((assignment) => assignment.subject_kind)].sort()).toEqual([
      'portal',
      'portal_group',
      'property',
    ])
    const portalAssignment = assignments.find(
      (assignment) => assignment.subject_kind === 'portal',
    )!
    expect(portalAssignment.portal_id).toBe(fixture.portalId)
    const groupAssignment = assignments.find(
      (assignment) => assignment.subject_kind === 'portal_group',
    )!
    expect(groupAssignment.portal_group_id).toBe(fixture.portalGroupId)

    const results = records(
      contribution.entries,
      'goal/results.json',
      'goal_monthly_result',
    )
    expect(results[0]).toMatchObject({
      id: fixture.monthlyResultId,
      assignment_id: fixture.scanProgram.assignmentId,
      evaluation_state: 'eligible',
      period_start: '2026-06-01T00:00:00.000000Z',
      period_end: '2026-07-01T00:00:00.000000Z',
      value: '30.0000000000',
      sample_count: 30,
      achieved: false,
    })
    expect(
      records(contribution.entries, 'goal/results.json', 'goal_result_revision').map(
        ({ id, revision }) => ({ id, revision }),
      ),
    ).toEqual([{ id: fixture.revisionId, revision: 1 }])

    const evaluations = records(
      contribution.entries,
      'goal/periods.json',
      'goal_evaluation',
    )
    expect(evaluations[0]).toMatchObject({ id: fixture.evaluationId, state: 'eligible' })
    expect(Object.keys(evaluations[0]!)).not.toContain('idempotency_key')
    expect(Object.keys(evaluations[0]!)).not.toContain('source_event_id')
  })

  it('answers no_data for an Organization that configured no goal', async () => {
    const organizationId = await seedOrganization('goal-export-empty-org')

    const contribution = await createGoalOrganizationExportAdapter(db).contribute({
      organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'goal',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    const fixture = await seedFixture()

    await expect(
      createGoalOrganizationExportAdapter(db).contribute({
        organizationId: fixture.organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
