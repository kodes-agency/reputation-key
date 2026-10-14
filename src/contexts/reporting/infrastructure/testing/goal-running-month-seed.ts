// Test-only: seeds a goal with the month it is running, and the readings that
// month has counted so far, the way production leaves them.
//
// A month still running is an `open` result in the `updating` state with no
// value: nothing writes a figure into it before the month closes, so "behind
// pace" has to count the figure from the readings. This writes exactly that
// shape, never an open and `eligible` row, which production cannot produce.
//
// `client` must be inside a transaction that rolls back (`holdTransaction`):
// goal results are intentionally undeletable.

import type { ClientBase } from 'pg'
import { METRIC_DEFINITION_IDS, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { seedLockedMonthTarget } from './goal-month-target-seed'

type Query = Pick<ClientBase, 'query'>

/** A fresh id from the database, so this module holds no ambient randomness. */
async function newId(client: Query): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT gen_random_uuid()::text AS id',
  )
  return rows[0]!.id
}

export type SeededMetric =
  'qualified_scans' | 'portal_rating_count' | 'portal_rating_average'

const VERSION_IDS: Record<SeededMetric, string> = {
  qualified_scans: METRIC_VERSION_IDS.qualifiedScanGoal,
  portal_rating_count: METRIC_VERSION_IDS.portalRatingCountGoal,
  portal_rating_average: METRIC_VERSION_IDS.portalRatingAverageGoal,
}

const DEFINITION_IDS: Record<SeededMetric, string> = {
  qualified_scans: METRIC_DEFINITION_IDS.qualifiedScan,
  portal_rating_count: METRIC_DEFINITION_IDS.portalRatingCount,
  portal_rating_average: METRIC_DEFINITION_IDS.portalRatingAverage,
}

const READING_METRIC_KEYS: Record<SeededMetric, string> = {
  qualified_scans: 'portal.qualified_scan',
  portal_rating_count: 'portal.rating_count',
  portal_rating_average: 'portal.rating_average',
}

export type SeededSubject =
  | Readonly<{ kind: 'property' }>
  | Readonly<{ kind: 'portal'; portalId: string }>
  | Readonly<{ kind: 'portal_group'; groupId: string }>

export type SeedGoalMonthInput = Readonly<{
  organizationId: string
  propertyId: string
  metric?: SeededMetric
  subject?: SeededSubject
  /** The version's target. */
  target: number
  /** The month's own target; omitted or null when the month uses its version's. */
  monthTarget?: number | null
  programStatus?: 'scheduled' | 'active' | 'paused' | 'ended'
  monthStatus?: 'open' | 'reconciling'
  timezone?: string
  /** The month, as instants. Defaults to August 2026 in UTC. */
  period?: Readonly<{ start: string; end: string }>
  /** Seeds an existing program's second subject instead of a new program. */
  program?: Readonly<{ programId: string; versionId: string }>
}>

export type SeededGoalMonth = Readonly<{
  programId: string
  versionId: string
  assignmentId: string
  resultId: string
}>

const AUGUST_2026 = {
  start: '2026-08-01T00:00:00Z',
  end: '2026-09-01T00:00:00Z',
} as const

/** A goal's program, version, assignment and running month, in one call. */
export async function seedGoalMonth(
  client: Query,
  input: SeedGoalMonthInput,
): Promise<SeededGoalMonth> {
  const metric = input.metric ?? 'qualified_scans'
  const subject = input.subject ?? { kind: 'property' }
  const period = input.period ?? AUGUST_2026
  const timezone = input.timezone ?? 'UTC'
  const programId = input.program?.programId ?? (await newId(client))
  const versionId = input.program?.versionId ?? (await newId(client))
  const assignmentId = await newId(client)
  const resultId = await newId(client)
  if (!input.program) {
    await client.query(
      `INSERT INTO goal_programs
         (id, organization_id, property_id, name, status, current_version,
          created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'Seeded goal', $4, 1, 'manager-1', $5, $5)`,
      [
        programId,
        input.organizationId,
        input.propertyId,
        input.programStatus ?? 'active',
        period.start,
      ],
    )
    await client.query(
      `INSERT INTO goal_program_versions
         (id, program_id, organization_id, property_id, version,
          metric_definition_id, metric_definition_version_id, metric_key,
          metric_minimum_sample, target_value, property_timezone, effective_from,
          change_reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, 'created',
         'manager-1', $11)`,
      [
        versionId,
        programId,
        input.organizationId,
        input.propertyId,
        DEFINITION_IDS[metric],
        VERSION_IDS[metric],
        metric,
        metric === 'portal_rating_average' ? 10 : 0,
        input.target,
        timezone,
        period.start,
      ],
    )
  }
  await client.query(
    `INSERT INTO goal_subject_assignments
       (id, program_id, program_version_id, organization_id, property_id,
        metric_key, subject_kind, property_subject_id, portal_group_id, portal_id,
        effective_from, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manager-1', $11)`,
    [
      assignmentId,
      programId,
      versionId,
      input.organizationId,
      input.propertyId,
      metric,
      subject.kind,
      subject.kind === 'property' ? input.propertyId : null,
      subject.kind === 'portal_group' ? subject.groupId : null,
      subject.kind === 'portal' ? subject.portalId : null,
      period.start,
    ],
  )
  // Open and `updating` with no value: a month still running holds no figure.
  await client.query(
    `INSERT INTO goal_monthly_results
       (id, assignment_id, program_id, program_version_id, organization_id,
        property_id, period_start, period_end, property_timezone, status,
        evaluation_state, sample_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', 'updating', 0, $7, $7)`,
    [
      resultId,
      assignmentId,
      programId,
      versionId,
      input.organizationId,
      input.propertyId,
      period.start,
      period.end,
      timezone,
    ],
  )
  if (input.monthStatus && input.monthStatus !== 'open') {
    await client.query(`UPDATE goal_monthly_results SET status = $2 WHERE id = $1`, [
      resultId,
      input.monthStatus,
    ])
  }
  // The target lock refuses a target on a month the database clock sees as over.
  if (input.monthTarget != null) {
    await seedLockedMonthTarget(client, resultId, input.monthTarget)
  }
  return { programId, versionId, assignmentId, resultId }
}

export type SeedReadingsInput = Readonly<{
  organizationId: string
  propertyId: string
  metric?: SeededMetric
  /** How many readings of one each. */
  count: number
  eventAt: string
  portalId?: string
  groupId?: string
  /** Overrides, to seed a reading the governed read would not trust. */
  sourcePolicy?: string
  dataQuality?: string
  /** The measure the reading claims to be of, if not the goal's own. */
  metricKey?: string
}>

/** `count` readings of one, as the guest gateway records a scan or a rating. */
export async function seedCountReadings(
  client: Query,
  input: SeedReadingsInput,
): Promise<readonly string[]> {
  const metric = input.metric ?? 'qualified_scans'
  const sourceEventPrefix = `seeded-${await newId(client)}`
  await client.query(
    `INSERT INTO metric_readings (
       organization_id, property_id, portal_id, group_id, metric_key, value,
       definition_version_id, source_event_id, source_policy, exact_value,
       sample_count, attribution_quality, recorded_at, event_at,
       property_local_date, data_quality, retention_class
     )
     SELECT $1, $2, $3, $4, $5, 1, $6, $7 || '-' || series.n, $8, 1, 1, 'exact',
       $9::timestamptz, $9::timestamptz, to_char($9::timestamptz, 'YYYY-MM-DD'),
       $10, 'standard'
     FROM generate_series(1, $11::integer) AS series(n)`,
    [
      input.organizationId,
      input.propertyId,
      input.portalId ?? null,
      input.groupId ?? null,
      input.metricKey ?? READING_METRIC_KEYS[metric],
      VERSION_IDS[metric],
      sourceEventPrefix,
      input.sourcePolicy ?? 'first_party_guest_gateway_metric',
      input.eventAt,
      input.dataQuality ?? 'exact',
      input.count,
    ],
  )
  return Array.from(
    { length: input.count },
    (_, index) => `${sourceEventPrefix}-${index + 1}`,
  )
}
