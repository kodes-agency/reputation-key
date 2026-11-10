// The production retention rule deletes expired v3 analyses with all dependent
// mentions, corrections and contributions, while keeping unexpired and v2 rows.
// Queries are confined to this suite's tenant.

import { sql } from 'drizzle-orm'
import type { Job } from 'bullmq'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  type AiAnalysisFixture,
  type AiAnalysisKey,
  installAiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import { withoutRetiredAiTables } from '#/shared/db/testing/retired-ai-tables-fixture'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createRetentionSweepHandler, RETENTION_RULES } from './retention-sweep.job'

const ORGANIZATION_ID = 'ai-v3-retention-test-org'
const PROPERTY_ID = '7a300000-0000-4000-8000-000000000002'
const RUN_AT = new Date('2026-10-29T12:00:00.000Z')
const GENERATED_AT = new Date('2026-09-08T10:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

let lease: TestLease
let db: Database
let fixture: AiAnalysisFixture
let sequence = 0

/** The production analysis rule, confined to this suite's Organization. */
const confinedRules = RETENTION_RULES.filter((rule) =>
  rule.subject.startsWith('ai_'),
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

async function seedAnalysis(
  profile: 'review-analysis-v2' | 'review-analysis-v3',
  expiresAt: Date,
): Promise<AiAnalysisKey> {
  sequence += 1
  return fixture.seedAnalysis({
    profile,
    expiresAt,
    analysisSequence: sequence,
    withContribution: true,
  })
}

/**
 * Two mentions with two sentence numbers each, on the analysis and on its contribution,
 * and a manager's correction beside each.
 */
async function seedMentions(key: AiAnalysisKey): Promise<void> {
  const keyValues = [
    key.organizationId,
    key.propertyId,
    key.reviewId,
    key.sourceEpoch,
    key.sourceRevision,
    key.analysisSequence,
  ]
  for (const table of [
    'ai_review_analysis_mentions',
    'ai_property_aggregate_contribution_mentions',
  ]) {
    for (const [ordinal, thing] of ['air conditioning', 'heating'].entries()) {
      await lease.pool.query(
        `INSERT INTO ${table}
           (organization_id, property_id, review_id, source_epoch, source_revision,
            analysis_sequence, mention_ordinal, topic, polarity, strength, thing, issue)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'facilities_equipment', 'negative', 'clear', $8, 'not working')`,
        [...keyValues, ordinal, thing],
      )
    }
  }
  // A manager's word beside each of the two mentions.
  for (const [ordinal, kind] of ['remove_topic', 'not_a_problem'].entries()) {
    await lease.pool.query(
      `INSERT INTO ai_review_analysis_mention_corrections
         (organization_id, property_id, review_id, source_epoch, source_revision,
          analysis_sequence, mention_ordinal, topic, kind, corrected_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'facilities_equipment', $8, 'a-manager', $9, $9)`,
      [...keyValues, ordinal, kind, GENERATED_AT],
    )
  }
  for (const ordinal of [0, 1]) {
    for (const sentence of [1, 2]) {
      await lease.pool.query(
        `INSERT INTO ai_review_analysis_mention_sentences
           (organization_id, property_id, review_id, source_epoch, source_revision,
            analysis_sequence, mention_ordinal, sentence_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [...keyValues, ordinal, sentence],
      )
    }
  }
}

const TABLES = [
  'ai_review_analyses',
  'ai_review_analysis_mentions',
  'ai_review_analysis_mention_sentences',
  'ai_review_analysis_mention_corrections',
  'ai_property_aggregate_contributions',
  'ai_property_aggregate_contribution_mentions',
] as const

async function rowsLeft(key: AiAnalysisKey): Promise<Readonly<Record<string, number>>> {
  const entries = await Promise.all(
    TABLES.map(async (table) => {
      const result = await lease.pool.query(
        `SELECT count(*)::int AS count FROM ${table} WHERE review_id = $1`,
        [key.reviewId],
      )
      return [table, Number(result.rows[0].count)] as const
    }),
  )
  return Object.fromEntries(entries)
}

const WHOLE = {
  ai_review_analyses: 1,
  ai_review_analysis_mentions: 2,
  ai_review_analysis_mention_sentences: 4,
  ai_review_analysis_mention_corrections: 2,
  ai_property_aggregate_contributions: 1,
  ai_property_aggregate_contribution_mentions: 2,
} as const
const GONE = Object.fromEntries(TABLES.map((table) => [table, 0]))

describe.sequential('Review Analysis v3 retention sweep (real PostgreSQL)', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
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
    await fixture?.remove()
    await lease?.release()
  })

  it('sweeps retained analysis derivatives with the retired tables absent', async () => {
    const expired = await seedAnalysis(
      'review-analysis-v3',
      new Date(RUN_AT.getTime() - DAY_MS),
    )
    await seedMentions(expired)
    await withoutRetiredAiTables(db, async (tx) => {
      const handler = createRetentionSweepHandler({
        db: tx,
        clock: () => RUN_AT,
        rules: confinedRules,
      })
      await handler({} as Job)
      const result = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM ai_review_analyses WHERE review_id = ${expired.reviewId}::uuid`,
      )
      expect(result.rows[0]?.count).toBe(0)
      const runs = await tx.execute(
        sql`SELECT subject, outcome FROM retention_runs WHERE started_at = ${RUN_AT} ORDER BY subject`,
      )
      expect(runs.rows).toEqual([
        { subject: 'ai_property_issue_groups.expired', outcome: 'completed' },
        { subject: 'ai_review_analyses.v3_expired', outcome: 'completed' },
      ])
    })
    expect(await rowsLeft(expired)).toEqual(WHOLE)
  })

  it('deletes an expired v3 analysis with every row that hangs from it', async () => {
    const expired = await seedAnalysis(
      'review-analysis-v3',
      new Date(RUN_AT.getTime() - DAY_MS),
    )
    await seedMentions(expired)
    expect(await rowsLeft(expired)).toEqual(WHOLE)

    await sweep()

    expect(await rowsLeft(expired)).toEqual(GONE)
  })

  it('keeps a v3 analysis until its own deadline, whatever else the sweep deletes', async () => {
    const expired = await seedAnalysis(
      'review-analysis-v3',
      new Date(RUN_AT.getTime() - 1_000),
    )
    const atTheDeadline = await seedAnalysis('review-analysis-v3', RUN_AT)
    const live = await seedAnalysis(
      'review-analysis-v3',
      new Date(RUN_AT.getTime() + 400 * DAY_MS),
    )
    for (const key of [expired, atTheDeadline, live]) await seedMentions(key)

    await sweep()

    expect(await rowsLeft(expired)).toEqual(GONE)
    expect(await rowsLeft(atTheDeadline)).toEqual(WHOLE)
    expect(await rowsLeft(live)).toEqual(WHOLE)
  })

  it('does not reach a v2 analysis: its 24 months are still unexecuted', async () => {
    const expiredV2 = await seedAnalysis(
      'review-analysis-v2',
      new Date(RUN_AT.getTime() - 30 * DAY_MS),
    )

    await sweep()

    expect(await rowsLeft(expiredV2)).toMatchObject({
      ai_review_analyses: 1,
      ai_property_aggregate_contributions: 1,
    })
  })

  it('drains a backlog in bounded batches', async () => {
    const keys: AiAnalysisKey[] = []
    for (let index = 0; index < 5; index += 1) {
      const key = await seedAnalysis(
        'review-analysis-v3',
        new Date(RUN_AT.getTime() - (index + 1) * DAY_MS),
      )
      await seedMentions(key)
      keys.push(key)
    }

    await sweep(2)

    for (const key of keys) expect(await rowsLeft(key)).toEqual(GONE)
    const runs = await lease.pool.query(
      `SELECT subject, outcome, batches, rows_deleted FROM retention_runs
       WHERE started_at = $1 AND subject = 'ai_review_analyses.v3_expired'`,
      [RUN_AT],
    )
    expect(runs.rows).toEqual([
      {
        subject: 'ai_review_analyses.v3_expired',
        outcome: 'completed',
        batches: 3,
        rows_deleted: 5,
      },
    ])
  })

  it('records content-free evidence for analysis and issue retention, and nothing else in a clean run', async () => {
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
