// Decision 16 of the v3 contract, against real PostgreSQL: the retention sweep
// deletes a Review Analysis v3 derivative 24 months after it was generated, takes
// every row that hangs from it in the same statement, spares a derivative that
// has not expired and the v2 analyses that still wait for their own rule, and
// deletes a day's star counts 24 calendar months after the day they count. The
// rules are the production ones, confined to this suite's tenant.

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
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createRetentionSweepHandler, RETENTION_RULES } from './retention-sweep.job'

const ORGANIZATION_ID = 'ai-v3-retention-test-org'
const PROPERTY_ID = '7a300000-0000-4000-8000-000000000002'
const RUN_AT = new Date('2026-10-29T12:00:00.000Z')
const GENERATED_AT = new Date('2026-09-08T10:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const SUBJECTS = [
  'ai_review_analyses.v3_expired',
  'ai_property_review_population_daily.expired',
] as const

let lease: TestLease
let db: Database
let fixture: AiAnalysisFixture
let sequence = 0

/** The two production AI rules, confined to this suite's Organization. */
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

/** Two mentions with two sentence numbers each, on the analysis and on its contribution. */
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
  ai_property_aggregate_contributions: 1,
  ai_property_aggregate_contribution_mentions: 2,
} as const
const GONE = Object.fromEntries(TABLES.map((table) => [table, 0]))

async function insertDay(localDate: string, updatedAt: Date): Promise<void> {
  await lease.pool.query(
    `INSERT INTO ai_property_review_population_daily
       (organization_id, property_id, local_date, source_epoch, property_profile_version,
        calendar_profile_version, review_count, text_review_count, rating_1_count,
        rating_2_count, rating_3_count, rating_4_count, rating_5_count,
        population_revision, updated_at)
     VALUES ($1, $2, $3, 0, 1, 'property-calendar-v1', 3, 1, 1, 0, 0, 0, 2, 1, $4)`,
    [ORGANIZATION_ID, PROPERTY_ID, localDate, updatedAt],
  )
}

async function daysLeft(): Promise<readonly string[]> {
  const result = await lease.pool.query(
    `SELECT local_date::text AS local_date FROM ai_property_review_population_daily
     WHERE organization_id = $1 ORDER BY local_date`,
    [ORGANIZATION_ID],
  )
  return result.rows.map((row) => row.local_date as string)
}

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
    await lease.pool.query(
      `DELETE FROM ai_property_review_population_daily WHERE organization_id = $1`,
      [ORGANIZATION_ID],
    )
    await lease.pool.query(`DELETE FROM retention_runs WHERE started_at = $1`, [RUN_AT])
  })

  afterAll(async () => {
    await lease.pool.query(`DELETE FROM retention_runs WHERE started_at = $1`, [RUN_AT])
    await fixture?.remove()
    await lease?.release()
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

  it('deletes the star counts of a day 24 calendar months on, whenever they were last updated', async () => {
    await insertDay('2024-10-27', RUN_AT)
    await insertDay('2024-10-30', GENERATED_AT)
    await insertDay('2026-10-28', GENERATED_AT)

    await sweep()

    expect(await daysLeft()).toEqual(['2024-10-30', '2026-10-28'])
  })

  it('records content-free evidence for both subjects, and nothing else in a clean run', async () => {
    await insertDay('2024-01-01', RUN_AT)

    await sweep()

    const runs = await lease.pool.query(
      `SELECT subject, outcome, error_code FROM retention_runs
       WHERE started_at = $1 ORDER BY subject`,
      [RUN_AT],
    )
    expect(runs.rows).toEqual([
      {
        subject: 'ai_property_review_population_daily.expired',
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
