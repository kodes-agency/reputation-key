import { randomUUID } from 'node:crypto'
import type { Job } from 'bullmq'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  type AiAnalysisFixture,
  installAiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createRetentionSweepHandler, RETENTION_RULES } from './retention-sweep.job'

const ORGANIZATION_ID = 'ai-issue-retention-test-org'
const PROPERTY_ID = '7a370000-0000-4000-8000-000000000001'
const RUN_AT = new Date('2026-10-30T12:00:00.000Z')
const GENERATED_AT = new Date('2026-09-08T10:00:00.000Z')
const PAST = new Date('2026-10-29T12:00:00.000Z')
const FUTURE = new Date('2026-10-31T12:00:00.000Z')
const SUBJECTS = [
  'ai_review_analyses.v3_expired',
  'ai_property_issue_groups.expired',
] as const

let lease: TestLease
let db: Database
let fixture: AiAnalysisFixture
let sequence = 0

const confinedRules = RETENTION_RULES.filter((rule) =>
  (SUBJECTS as readonly string[]).includes(rule.subject),
).map((rule) => ({
  ...rule,
  extraWhere: `${rule.extraWhere === undefined ? '' : `(${rule.extraWhere}) AND `}organization_id = '${ORGANIZATION_ID}'`,
}))

async function sweep(batchSize = 500): Promise<void> {
  const handler = createRetentionSweepHandler({
    db,
    clock: () => RUN_AT,
    rules: confinedRules,
    batchSize,
  })
  await handler({} as Job)
}

function letters(index: number): string {
  const first = String.fromCharCode(97 + Math.floor(index / 26))
  const second = String.fromCharCode(97 + (index % 26))
  return `unit ${first}${second}`
}

async function insertGroup(
  expiresAt: Date,
  canonicalKey = 'air conditioning',
  mergedIntoIssueId: string | null = null,
): Promise<string> {
  const id = randomUUID()
  await lease.pool.query(
    `INSERT INTO ai_property_issue_groups (
       id, organization_id, property_id, topic, canonical_thing, canonical_key,
       merged_into_issue_id, created_at, updated_at, last_seen_at, expires_at,
       normalization_version
     ) VALUES ($1, $2, $3, 'facilities_equipment', $4, $4, $5,
               $6, $6, $6, $7, 'property-issue-normalization-v1')`,
    [id, ORGANIZATION_ID, PROPERTY_ID, canonicalKey, mergedIntoIssueId, PAST, expiresAt],
  )
  return id
}

async function insertMember(groupId: string, memberKey = 'air conditioning') {
  await lease.pool.query(
    `INSERT INTO ai_property_issue_members (
       issue_group_id, organization_id, property_id, topic, member_key,
       member_thing, source, created_at, last_seen_at
     ) VALUES ($1, $2, $3, 'facilities_equipment', $4, $4,
               'deterministic', $5, $5)`,
    [groupId, ORGANIZATION_ID, PROPERTY_ID, memberKey, PAST],
  )
}

async function counts() {
  const result = await lease.pool.query(
    `SELECT
       (SELECT count(*)::int FROM ai_property_issue_groups WHERE organization_id = $1) AS groups,
       (SELECT count(*)::int FROM ai_property_issue_members WHERE organization_id = $1) AS members`,
    [ORGANIZATION_ID],
  )
  return result.rows[0] as { groups: number; members: number }
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool)
  fixture = await installAiAnalysisFixture({
    db,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    now: GENERATED_AT,
  })
})

beforeEach(async () => {
  await fixture.reset()
  await lease.pool.query(`DELETE FROM retention_runs WHERE started_at = $1`, [RUN_AT])
})

afterAll(async () => {
  await lease.pool.query(`DELETE FROM retention_runs WHERE started_at = $1`, [RUN_AT])
  await fixture.remove()
  await lease.release()
})

describe.sequential('Property issue group retention sweep', () => {
  it('deletes an expired unreferenced group with its members and redirects', async () => {
    const target = await insertGroup(PAST, 'cooling unit')
    const redirect = await insertGroup(PAST, 'air conditioning', target)
    await insertMember(target, 'cooling unit')
    await insertMember(redirect)

    await sweep()

    expect(await counts()).toEqual({ groups: 0, members: 0 })
  })

  it('keeps an expired group while a contribution mention references it', async () => {
    const groupId = await insertGroup(PAST)
    const key = await fixture.seedAnalysis({
      profile: 'review-analysis-v3',
      expiresAt: FUTURE,
      analysisSequence: ++sequence,
      withContribution: true,
    })
    await lease.pool.query(
      `INSERT INTO ai_property_aggregate_contribution_mentions (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, polarity, strength, thing,
         issue, issue_group_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'facilities_equipment', 'negative',
                 'clear', 'air conditioning', 'noisy', $7)`,
      [
        key.organizationId,
        key.propertyId,
        key.reviewId,
        key.sourceEpoch,
        key.sourceRevision,
        key.analysisSequence,
        groupId,
      ],
    )

    await sweep()

    expect(await counts()).toEqual({ groups: 1, members: 0 })
  })

  it('keeps an unexpired unreferenced group', async () => {
    await insertGroup(FUTURE)

    await sweep()

    expect(await counts()).toEqual({ groups: 1, members: 0 })
  })

  it('deletes an expired analysis and then the group it was holding in one run', async () => {
    const groupId = await insertGroup(PAST)
    await insertMember(groupId)
    const key = await fixture.seedAnalysis({
      profile: 'review-analysis-v3',
      expiresAt: PAST,
      analysisSequence: ++sequence,
      withContribution: true,
    })
    await lease.pool.query(
      `INSERT INTO ai_property_aggregate_contribution_mentions (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, polarity, strength, thing,
         issue, issue_group_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'facilities_equipment', 'negative',
                 'clear', 'air conditioning', 'noisy', $7)`,
      [
        key.organizationId,
        key.propertyId,
        key.reviewId,
        key.sourceEpoch,
        key.sourceRevision,
        key.analysisSequence,
        groupId,
      ],
    )

    await sweep()

    expect(await counts()).toEqual({ groups: 0, members: 0 })
  })

  it('closes a batch-capped subject as completed so the next run can continue', async () => {
    for (let index = 0; index < 101; index += 1) {
      await insertGroup(PAST, letters(index))
    }

    await sweep(1)

    expect((await counts()).groups).toBe(1)
    const run = await lease.pool.query(
      `SELECT subject, outcome, batches, rows_deleted, error_code
       FROM retention_runs
       WHERE started_at = $1 AND subject = 'ai_property_issue_groups.expired'`,
      [RUN_AT],
    )
    expect(run.rows).toEqual([
      {
        subject: 'ai_property_issue_groups.expired',
        outcome: 'completed',
        batches: 100,
        rows_deleted: 100,
        error_code: null,
      },
    ])
  })

  it('records only content-free evidence for both production subjects', async () => {
    await insertGroup(PAST)

    await sweep()

    const runs = await lease.pool.query(
      `SELECT subject, outcome, error_code FROM retention_runs
       WHERE started_at = $1 ORDER BY subject`,
      [RUN_AT],
    )
    expect(runs.rows).toEqual([
      {
        subject: 'ai_property_issue_groups.expired',
        outcome: 'completed',
        error_code: null,
      },
      {
        subject: 'ai_review_analyses.v3_expired',
        outcome: 'completed',
        error_code: null,
      },
    ])
  })
})
