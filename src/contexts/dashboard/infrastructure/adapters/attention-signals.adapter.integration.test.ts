import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { Database } from '#/shared/db'
import * as schema from '#/shared/db/schema'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '#/contexts/metric/application/public-api'
import { createAttentionSignalsAdapter } from './attention-signals.adapter'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const ORGANIZATION = organizationId(`org-attention-union-test-${randomUUID()}`)
const PROPERTY = propertyId(randomUUID())
const REVIEW_ONE = randomUUID()
const REVIEW_TWO = randomUUID()
const GOAL_PROGRAM = randomUUID()
const GOAL_PROGRAM_VERSION = randomUUID()
const GOAL_ASSIGNMENT = randomUUID()
const GOAL_RESULT = randomUUID()
let pool: Pool
let db: Database

beforeAll(async () => {
  // Canonical Goal results are intentionally undeletable. Keep the fixture in
  // one pinned transaction and roll it back after the assertion.
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  await pool.query('BEGIN')
  db = drizzle(pool, { schema }) as unknown as Database
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Attention union test', $2, now())
     ON CONFLICT (id) DO NOTHING`,
    [ORGANIZATION, `attention-union-${randomUUID()}`],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Attention Property', 'attention-property', 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORGANIZATION],
  )
})

beforeAll(async () => {
  for (const [id, externalId] of [
    [REVIEW_ONE, 'attention-review-one'],
    [REVIEW_TWO, 'attention-review-two'],
  ] as const) {
    await pool.query(
      `INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, rating, reviewed_at, expires_at, content_expires_at,
         source_epoch, source_revision, analysis_sequence,
         ai_source_byte_length, ai_source_digest
       ) VALUES (
         $1, $2, $3, 'google', $4, 'locations/attention', 4,
         '2026-08-20T00:00:00Z', '2026-09-25T00:00:00Z',
         '2026-09-25T00:00:00Z', 0, 0, 0, 1, repeat('0', 64)
       )`,
      [id, ORGANIZATION, PROPERTY, externalId],
    )
  }

  for (const item of [
    {
      id: randomUUID(),
      sourceType: 'review',
      sourceId: REVIEW_ONE,
      status: 'open',
      escalated: true,
    },
    {
      id: randomUUID(),
      sourceType: 'feedback',
      sourceId: randomUUID(),
      status: 'open',
      escalated: true,
    },
    {
      id: randomUUID(),
      sourceType: 'feedback',
      sourceId: randomUUID(),
      status: 'closed',
      escalated: true,
    },
    {
      id: randomUUID(),
      sourceType: 'feedback',
      sourceId: randomUUID(),
      status: 'closed',
      escalated: false,
    },
  ] as const) {
    await pool.query(
      `INSERT INTO inbox_items (
         id, organization_id, property_id, source_type, source_id,
         status, is_escalated, escalated_at, source_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2026-08-20T00:00:00Z')`,
      [
        item.id,
        ORGANIZATION,
        PROPERTY,
        item.sourceType,
        item.sourceId,
        item.status,
        item.escalated,
        item.escalated ? NOW : null,
      ],
    )
  }

  await pool.query(
    `INSERT INTO goal_programs
       (id, organization_id, property_id, name, status, current_version,
        created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Canonical attention Goal', 'active', 1,
             'manager-1', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
    [GOAL_PROGRAM, ORGANIZATION, PROPERTY],
  )
  await pool.query(
    `INSERT INTO goal_program_versions
       (id, program_id, organization_id, property_id, version,
        metric_definition_id, metric_definition_version_id, metric_key,
        metric_minimum_sample, target_value, property_timezone, effective_from,
        change_reason, created_by, created_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, 'qualified_scans',
       0, 100, 'UTC', '2026-08-01T00:00:00Z', 'created', 'manager-1',
       '2026-08-01T00:00:00Z')`,
    [
      GOAL_PROGRAM_VERSION,
      GOAL_PROGRAM,
      ORGANIZATION,
      PROPERTY,
      METRIC_DEFINITION_IDS.qualifiedScan,
      METRIC_VERSION_IDS.qualifiedScanGoal,
    ],
  )
  await pool.query(
    `INSERT INTO goal_subject_assignments
       (id, program_id, program_version_id, organization_id, property_id,
        metric_key, subject_kind, property_subject_id, effective_from,
        created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, 'qualified_scans', 'property', $5,
             '2026-08-01T00:00:00Z', 'manager-1', '2026-08-01T00:00:00Z')`,
    [GOAL_ASSIGNMENT, GOAL_PROGRAM, GOAL_PROGRAM_VERSION, ORGANIZATION, PROPERTY],
  )
  await pool.query(
    `INSERT INTO goal_monthly_results
       (id, assignment_id, program_id, program_version_id, organization_id,
        property_id, period_start, period_end, property_timezone, status,
        evaluation_state, value, sample_count, achieved, source_complete_through,
        evaluation_watermark, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-08-01T00:00:00Z',
             '2026-09-01T00:00:00Z', 'UTC', 'open', 'eligible', 1, 1, false,
             $7, $7, '2026-08-01T00:00:00Z', $7)`,
    [
      GOAL_RESULT,
      GOAL_ASSIGNMENT,
      GOAL_PROGRAM,
      GOAL_PROGRAM_VERSION,
      ORGANIZATION,
      PROPERTY,
      NOW,
    ],
  )
})

afterAll(async () => {
  await pool.query('ROLLBACK')
  await pool.end()
})

describe('attention signal work-set union', () => {
  it('counts Dashboard-owned work anchors while leaving overdue targets to Inbox', async () => {
    const adapter = createAttentionSignalsAdapter(db, () => NOW)

    await expect(adapter.getAttentionCounts(ORGANIZATION, PROPERTY)).resolves.toEqual({
      overdue: 0,
      itemsToTriage: 2,
      escalated: 3,
      goalsBehindPace: 1,
      attentionWork: 4,
    })
  })
})
