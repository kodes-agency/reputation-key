// What migration 0078 enforces, against real PostgreSQL: the v3 mention tables
// and their checks, the analysis result check that tells a v2 row from a v3 one,
// the operation lineage, the provider execution-control scope, the daily star
// counts and the Property category. The vocabularies and the migration text are
// pinned without a database in `ai-review-analysis-v3.schema.test.ts`.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  type AiAnalysisFixture,
  type AiAnalysisKey,
  installAiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const ORGANIZATION_ID = 'ai-v3-schema-test-org'
const PROPERTY_ID = '7a300000-0000-4000-8000-000000000001'
const NOW = new Date('2026-09-08T10:00:00.000Z')
const EXPIRES_AT = new Date('2028-09-07T10:00:00.000Z')

const MENTION_TABLES = [
  'ai_review_analysis_mentions',
  'ai_property_aggregate_contribution_mentions',
] as const

type MentionFields = Readonly<{
  topic: string
  polarity: string
  strength: string
  thing: string | null
  issue: string | null
  names_person: string | null
}>

const DEFAULT_MENTION: MentionFields = {
  topic: 'facilities_equipment',
  polarity: 'negative',
  strength: 'clear',
  thing: 'air conditioning',
  issue: 'not working',
  names_person: null,
}

let lease: TestLease
let db: Database
let fixture: AiAnalysisFixture
let sequence = 0

async function seedV3(
  overrides: Partial<Parameters<AiAnalysisFixture['seedAnalysis']>[0]> = {},
): Promise<AiAnalysisKey> {
  sequence += 1
  return fixture.seedAnalysis({
    profile: 'review-analysis-v3',
    expiresAt: EXPIRES_AT,
    analysisSequence: sequence,
    withContribution: true,
    ...overrides,
  })
}

function keyValues(key: AiAnalysisKey): readonly unknown[] {
  return [
    key.organizationId,
    key.propertyId,
    key.reviewId,
    key.sourceEpoch,
    key.sourceRevision,
    key.analysisSequence,
  ]
}

async function insertMention(
  table: (typeof MENTION_TABLES)[number],
  key: AiAnalysisKey,
  ordinal: number,
  fields: Partial<MentionFields> = {},
) {
  const mention = { ...DEFAULT_MENTION, ...fields }
  return lease.pool.query(
    `INSERT INTO ${table}
       (organization_id, property_id, review_id, source_epoch, source_revision,
        analysis_sequence, mention_ordinal, topic, polarity, strength, thing, issue,
        names_person)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      ...keyValues(key),
      ordinal,
      mention.topic,
      mention.polarity,
      mention.strength,
      mention.thing,
      mention.issue,
      mention.names_person,
    ],
  )
}

async function insertSentence(key: AiAnalysisKey, ordinal: number, sentence: number) {
  return lease.pool.query(
    `INSERT INTO ai_review_analysis_mention_sentences
       (organization_id, property_id, review_id, source_epoch, source_revision,
        analysis_sequence, mention_ordinal, sentence_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [...keyValues(key), ordinal, sentence],
  )
}

const count = async (table: string, key: AiAnalysisKey): Promise<number> =>
  Number(
    (
      await lease.pool.query(
        `SELECT count(*)::int AS count FROM ${table} WHERE review_id = $1`,
        [key.reviewId],
      )
    ).rows[0].count,
  )

const violates = (constraint: string) => ({ code: '23514', constraint })

/** Run a statement in a transaction that is always rolled back; resolves to the error, if any. */
async function inRolledBackTransaction(
  work: (client: PoolClient) => Promise<void>,
): Promise<unknown> {
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    await work(client)
    return undefined
  } catch (error) {
    return error
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

describe.sequential('Review Analysis v3 storage (real PostgreSQL)', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    fixture = await installAiAnalysisFixture({
      db,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      now: NOW,
    })
  })

  afterAll(async () => {
    await fixture?.remove()
    await lease?.release()
  })

  beforeEach(async () => {
    await fixture.reset()
  })

  describe.each(MENTION_TABLES)('%s', (table) => {
    const parent = (key: AiAnalysisKey) => key

    it('stores a cause, a topic-level mention and a mention that names a team member', async () => {
      const key = await seedV3()

      await insertMention(table, parent(key), 0)
      await insertMention(table, parent(key), 1, {
        topic: 'staff_service',
        polarity: 'positive',
        strength: 'strong',
        thing: 'front desk',
        issue: 'helpful',
        names_person: 'team_member',
      })
      await insertMention(table, parent(key), 2, {
        topic: 'cleanliness',
        thing: null,
        issue: null,
      })

      expect(await count(table, key)).toBe(3)
    })

    it('refuses a topic, polarity, strength or names flag outside the v3 vocabulary', async () => {
      const key = await seedV3()
      const refused: ReadonlyArray<Partial<MentionFields>> = [
        { topic: 'wait_time' },
        { polarity: 'mixed' },
        { strength: 'severe' },
        { strength: 'mild ' },
        { names_person: 'guest' },
      ]

      for (const [index, fields] of refused.entries()) {
        await expect(
          insertMention(table, key, index, fields),
          JSON.stringify(fields),
        ).rejects.toMatchObject(violates(`${table}_values_valid`))
      }
    })

    it('keeps a mention ordinal inside the 48-mention bound', async () => {
      const key = await seedV3()

      await insertMention(table, key, 47, { thing: null, issue: null })
      for (const ordinal of [48, -1]) {
        await expect(insertMention(table, key, ordinal)).rejects.toMatchObject(
          violates(`${table}_values_valid`),
        )
      }
    })

    it('holds a cause to one to three lowercase words and an issue wherever there is a thing', async () => {
      const key = await seedV3()
      await insertMention(table, key, 0, { thing: 'check-in queue', issue: 'slow' })

      const refused: ReadonlyArray<Partial<MentionFields>> = [
        { thing: 'Air conditioning' },
        { thing: 'air conditioning unit upstairs' },
        { thing: 'room 12' },
        { thing: 'air  conditioning' },
        { thing: '-air' },
        { issue: 'not working at all today' },
        { issue: 'ПЛОХО' },
        { thing: 'air conditioning', issue: null },
      ]
      for (const [index, fields] of refused.entries()) {
        await expect(
          insertMention(table, key, index + 1, fields),
          JSON.stringify(fields),
        ).rejects.toMatchObject(violates(`${table}_cause_valid`))
      }
    })

    it('allows an issue with no thing: a topic-level mention that says what was wrong', async () => {
      const key = await seedV3()

      await insertMention(table, key, 0, { thing: null, issue: 'noisy' })

      expect(await count(table, key)).toBe(1)
    })

    it('stores one mention per topic, cause and polarity, and a topic-level mention once', async () => {
      const key = await seedV3()
      await insertMention(table, key, 0)
      await insertMention(table, key, 1, { thing: null, issue: null })

      await expect(
        insertMention(table, key, 2, { issue: 'noisy' }),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: `${table}_identity_unique`,
      })
      await expect(
        insertMention(table, key, 3, { thing: null, issue: null, strength: 'strong' }),
      ).rejects.toMatchObject({ code: '23505', constraint: `${table}_identity_unique` })

      // Another polarity, another cause and another topic are other mentions.
      await insertMention(table, key, 4, { polarity: 'positive' })
      await insertMention(table, key, 5, { thing: 'heating', issue: 'not working' })
      await insertMention(table, key, 6, { topic: 'price_billing' })
      expect(await count(table, key)).toBe(5)
    })

    it('refuses a mention of an analysis or contribution that does not exist', async () => {
      const key = await seedV3()
      const missing = { ...key, analysisSequence: key.analysisSequence + 1000 }

      await expect(insertMention(table, missing, 0)).rejects.toMatchObject({
        code: '23503',
      })
    })

    it('goes with the analysis it belongs to', async () => {
      const key = await seedV3()
      await insertMention(table, key, 0)

      await lease.pool.query(
        `DELETE FROM ai_review_analyses WHERE review_id = $1 AND analysis_sequence = $2`,
        [key.reviewId, key.analysisSequence],
      )

      expect(await count(table, key)).toBe(0)
    })
  })

  describe('ai_review_analysis_mention_sentences', () => {
    it('stores the sentence numbers a mention cites, once each', async () => {
      const key = await seedV3()
      await insertMention('ai_review_analysis_mentions', key, 0)

      await insertSentence(key, 0, 1)
      await insertSentence(key, 0, 3)
      await expect(insertSentence(key, 0, 3)).rejects.toMatchObject({ code: '23505' })

      expect(await count('ai_review_analysis_mention_sentences', key)).toBe(2)
    })

    it('refuses a sentence number below 1 or above the contract bound', async () => {
      const key = await seedV3()
      await insertMention('ai_review_analysis_mentions', key, 0)

      for (const sentence of [0, -3, 10_001]) {
        await expect(insertSentence(key, 0, sentence)).rejects.toMatchObject(
          violates('ai_review_analysis_mention_sentences_number_valid'),
        )
      }
      await insertSentence(key, 0, 10_000)
    })

    it('refuses a sentence of a mention that does not exist', async () => {
      const key = await seedV3()

      await expect(insertSentence(key, 5, 1)).rejects.toMatchObject({ code: '23503' })
    })

    it('goes with its mention and with its analysis', async () => {
      const key = await seedV3()
      await insertMention('ai_review_analysis_mentions', key, 0)
      await insertMention('ai_review_analysis_mentions', key, 1, { thing: 'heating' })
      await insertSentence(key, 0, 1)
      await insertSentence(key, 1, 2)

      await lease.pool.query(
        `DELETE FROM ai_review_analysis_mentions WHERE review_id = $1 AND mention_ordinal = 0`,
        [key.reviewId],
      )
      expect(await count('ai_review_analysis_mention_sentences', key)).toBe(1)

      await lease.pool.query(`DELETE FROM ai_review_analyses WHERE review_id = $1`, [
        key.reviewId,
      ])
      expect(await count('ai_review_analysis_mention_sentences', key)).toBe(0)
    })
  })

  describe('contribution mentions', () => {
    it('go with the contribution, not only with the analysis', async () => {
      const key = await seedV3()
      await insertMention('ai_property_aggregate_contribution_mentions', key, 0)

      await lease.pool.query(
        `DELETE FROM ai_property_aggregate_contributions WHERE review_id = $1`,
        [key.reviewId],
      )

      expect(await count('ai_property_aggregate_contribution_mentions', key)).toBe(0)
      expect(await count('ai_review_analyses', key)).toBe(1)
    })

    it('need a contribution: an analysis alone is not enough', async () => {
      const key = await seedV3({ withContribution: false })

      await expect(
        insertMention('ai_property_aggregate_contribution_mentions', key, 0),
      ).rejects.toMatchObject({ code: '23503' })
    })
  })

  describe('ai_review_analyses result check', () => {
    const update = (key: AiAnalysisKey, assignments: string) =>
      lease.pool.query(
        `UPDATE ai_review_analyses SET ${assignments}
         WHERE review_id = $1 AND analysis_sequence = $2`,
        [key.reviewId, key.analysisSequence],
      )

    it('accepts a v3 analysis with no primary category, and an Urgent one with its reason', async () => {
      await seedV3({ attention: 'medium' })
      await seedV3({ attention: 'urgent', urgentReason: 'health' })

      const rows = await lease.pool.query(
        `SELECT attention, urgent_reason, primary_category FROM ai_review_analyses
         WHERE organization_id = $1 ORDER BY attention`,
        [ORGANIZATION_ID],
      )
      expect(rows.rows).toEqual([
        { attention: 'medium', urgent_reason: null, primary_category: null },
        { attention: 'urgent', urgent_reason: 'health', primary_category: null },
      ])
    })

    it('ties the Urgent reason to urgent attention, in both directions', async () => {
      const calm = await seedV3({ attention: 'high' })
      const urgent = await seedV3({ attention: 'urgent', urgentReason: 'safety' })

      await expect(update(calm, `urgent_reason = 'safety'`)).rejects.toMatchObject(
        violates('ai_review_analyses_result_valid'),
      )
      await expect(update(urgent, `urgent_reason = NULL`)).rejects.toMatchObject(
        violates('ai_review_analyses_result_valid'),
      )
      await expect(update(urgent, `urgent_reason = 'billing'`)).rejects.toMatchObject(
        violates('ai_review_analyses_result_valid'),
      )
      await update(urgent, `urgent_reason = 'legal_threat'`)
    })

    it('gives a v3 analysis no primary category and no issue label', async () => {
      const key = await seedV3()

      await expect(update(key, `primary_category = 'service'`)).rejects.toMatchObject(
        violates('ai_review_analyses_result_valid'),
      )
      await expect(update(key, `issue_label = 'noise'`)).rejects.toMatchObject(
        violates('ai_review_analyses_result_valid'),
      )
    })

    it('keeps a v2 analysis as it was: a category, an issue label allowed, no Urgent reason', async () => {
      const key = await seedV3({ profile: 'review-analysis-v2', attention: 'urgent' })

      await update(key, `issue_label = 'noise'`)
      await expect(update(key, `urgent_reason = 'safety'`)).rejects.toMatchObject(
        violates('ai_review_analyses_result_valid'),
      )
      await expect(update(key, `primary_category = 'topic'`)).rejects.toMatchObject(
        violates('ai_review_analyses_result_valid'),
      )
    })

    it('lets a v3 analysis be unavailable with nothing else set', async () => {
      const key = await seedV3()

      await update(
        key,
        `status = 'unavailable', unavailable_reason = 'language_not_supported',
         sentiment = NULL, attention = NULL, urgent_reason = NULL`,
      )
      await expect(update(key, `urgent_reason = 'safety'`)).rejects.toMatchObject(
        violates('ai_review_analyses_result_valid'),
      )
    })
  })

  describe('ai_property_aggregate_contributions result check', () => {
    it('lets a ready contribution leave primary_category null, and still names the 18 for a v2 row', async () => {
      const key = await seedV3()

      const rows = await lease.pool.query(
        `SELECT primary_category FROM ai_property_aggregate_contributions WHERE review_id = $1`,
        [key.reviewId],
      )
      expect(rows.rows).toEqual([{ primary_category: null }])
      await expect(
        lease.pool.query(
          `UPDATE ai_property_aggregate_contributions SET primary_category = 'topic' WHERE review_id = $1`,
          [key.reviewId],
        ),
      ).rejects.toMatchObject(
        violates('ai_property_aggregate_contributions_result_valid'),
      )
      await lease.pool.query(
        `UPDATE ai_property_aggregate_contributions SET primary_category = 'room' WHERE review_id = $1`,
        [key.reviewId],
      )
    })
  })

  describe('ai_operations lineage', () => {
    const SET_V3 = `operation_profile_version = 'review-analysis-v3'`
    const LINEAGE = `provider_id = 'anthropic', provider_model = 'synthetic-model',
      provider_request_profile_version = 'profile-v1', provider_request_profile_digest = '${'1'.repeat(64)}',
      vocabulary_hint_set_id = 'lodging', vocabulary_hint_set_version = 'review-vocabulary-hints-v1',
      vocabulary_hint_set_digest = '${'2'.repeat(64)}',
      normalization_profile_version = 'review-analysis-normalization-v1',
      normalization_profile_digest = '${'3'.repeat(64)}'`
    const updateOperation = (key: AiAnalysisKey, assignments: string) =>
      lease.pool.query(
        `UPDATE ai_operations SET ${assignments} WHERE review_id = $1 AND analysis_sequence = $2`,
        [key.reviewId, key.analysisSequence],
      )

    it('leaves every earlier operation with no lineage and no flags', async () => {
      const key = await seedV3({ profile: 'review-analysis-v2' })

      const row = (
        await lease.pool.query(
          `SELECT provider_id, vocabulary_hint_set_id, normalization_profile_version,
                  normalization_flags, dropped_mention_count
           FROM ai_operations WHERE review_id = $1`,
          [key.reviewId],
        )
      ).rows[0]
      expect(row).toEqual({
        provider_id: null,
        vocabulary_hint_set_id: null,
        normalization_profile_version: null,
        normalization_flags: [],
        dropped_mention_count: 0,
      })
    })

    it('requires a v3 operation to name its provider, hint set and normalizer', async () => {
      const key = await seedV3({ profile: 'review-analysis-v2' })

      await expect(updateOperation(key, SET_V3)).rejects.toMatchObject(
        violates('ai_operations_v3_lineage_required'),
      )
      await updateOperation(key, `${SET_V3}, ${LINEAGE}`)
      await expect(
        updateOperation(
          key,
          `provider_id = NULL, provider_model = NULL, provider_request_profile_version = NULL, provider_request_profile_digest = NULL`,
        ),
      ).rejects.toMatchObject(violates('ai_operations_v3_lineage_required'))
    })

    it('holds each lineage group to all-or-none and to its format', async () => {
      const key = await seedV3({ profile: 'review-analysis-v2' })
      const refused: ReadonlyArray<readonly [string, string]> = [
        [`provider_id = 'openai'`, 'ai_operations_provider_lineage_valid'],
        [
          `provider_id = 'gemini', provider_model = 'm', provider_request_profile_version = 'v', provider_request_profile_digest = '${'1'.repeat(64)}'`,
          'ai_operations_provider_lineage_valid',
        ],
        [
          `provider_id = 'openai', provider_model = 'm', provider_request_profile_version = 'v', provider_request_profile_digest = 'XYZ'`,
          'ai_operations_provider_lineage_valid',
        ],
        [`vocabulary_hint_set_id = 'lodging'`, 'ai_operations_vocabulary_lineage_valid'],
        [
          `vocabulary_hint_set_id = 'Lodging Set', vocabulary_hint_set_version = 'v', vocabulary_hint_set_digest = '${'2'.repeat(64)}'`,
          'ai_operations_vocabulary_lineage_valid',
        ],
        [
          `normalization_profile_version = 'v'`,
          'ai_operations_normalization_lineage_valid',
        ],
        [
          `normalization_flags = ARRAY['mentions_capped']::text[]`,
          'ai_operations_normalization_lineage_valid',
        ],
      ]

      for (const [assignments, constraint] of refused) {
        await expect(
          updateOperation(key, assignments),
          assignments,
        ).rejects.toMatchObject(violates(constraint))
      }
    })

    it('admits only the closed, content-free normalizer flags and at most 48 dropped mentions', async () => {
      const key = await seedV3({ profile: 'review-analysis-v2' })
      await updateOperation(key, `${SET_V3}, ${LINEAGE}`)

      await updateOperation(
        key,
        `normalization_flags = ARRAY['mentions_capped', 'cause_refused_name']::text[], dropped_mention_count = 3`,
      )
      for (const assignments of [
        `normalization_flags = ARRAY['the guest wrote rude things']::text[]`,
        `normalization_flags = ARRAY['mentions_capped', NULL]::text[]`,
        `dropped_mention_count = 49`,
        `dropped_mention_count = -1`,
      ]) {
        await expect(
          updateOperation(key, assignments),
          assignments,
        ).rejects.toMatchObject(violates('ai_operations_normalization_lineage_valid'))
      }
    })
  })

  describe('ai_execution_control scopes', () => {
    const insertTransition = (
      client: PoolClient,
      scope: { kind: string; value: string | null; key: string },
    ) =>
      client.query(
        `INSERT INTO ai_execution_control_transitions
           (control_id, generation, predecessor_generation, scope_key, scope_kind,
            scope_value, execution_state, admission_state, reason_code,
            ticket_reference, occurred_at)
         VALUES ($1, 1, NULL, $2, $3, $4, 'killed', 'draining', 'integration_test', 'test', now())`,
        [randomUUID(), scope.key, scope.kind, scope.value],
      )

    it.each(['openai', 'anthropic'])('admits the %s provider scope', async (provider) => {
      const error = await inRolledBackTransaction(async (client) => {
        await insertTransition(client, {
          kind: 'provider',
          value: provider,
          key: `provider:${provider}`,
        })
      })

      expect(error).toBeUndefined()
    })

    it('refuses a provider scope for an unknown provider or with another key', async () => {
      for (const scope of [
        { kind: 'provider', value: 'gemini', key: 'provider:gemini' },
        { kind: 'provider', value: 'openai', key: 'provider:anthropic' },
        { kind: 'provider', value: null, key: 'provider:openai' },
      ]) {
        const error = await inRolledBackTransaction(async (client) => {
          await insertTransition(client, scope)
        })
        expect(error, JSON.stringify(scope)).toMatchObject(
          violates('ai_execution_control_transitions_scope_valid'),
        )
      }
    })

    it('keeps a deployment profile from taking a provider id, so one key names one kind', async () => {
      const taken = await inRolledBackTransaction(async (client) => {
        await insertTransition(client, {
          kind: 'provider_deployment_profile',
          value: 'openai',
          key: 'provider:openai',
        })
      })
      const ordinary = await inRolledBackTransaction(async (client) => {
        await insertTransition(client, {
          kind: 'provider_deployment_profile',
          // Not a profile the database holds: private-beta-global-v2 has its own
          // head since migration 0083, and a second one under its key is refused.
          value: 'private-beta-global-v9',
          key: 'provider:private-beta-global-v9',
        })
      })

      expect(taken).toMatchObject(
        violates('ai_execution_control_transitions_scope_valid'),
      )
      expect(ordinary).toBeUndefined()
    })

    it('applies the same scope rule to a control head', async () => {
      const controlId = randomUUID()
      const insertHead = (client: PoolClient, provider: string) =>
        client.query(
          `INSERT INTO ai_execution_control_heads
             (scope_key, scope_kind, scope_value, control_id, generation,
              execution_state, admission_state, updated_at)
           VALUES ($1, 'provider', $2, $3, 1, 'killed', 'draining', now())`,
          [`provider:${provider}`, provider, controlId],
        )
      const accepted = await inRolledBackTransaction(async (client) => {
        await client.query(
          `INSERT INTO ai_execution_control_transitions
             (control_id, generation, predecessor_generation, scope_key, scope_kind,
              scope_value, execution_state, admission_state, reason_code,
              ticket_reference, occurred_at)
           VALUES ($1, 1, NULL, 'provider:openai', 'provider', 'openai', 'killed',
                   'draining', 'integration_test', 'test', now())`,
          [controlId],
        )
        await insertHead(client, 'openai')
      })
      const refused = await inRolledBackTransaction(async (client) => {
        await insertHead(client, 'gemini')
      })

      expect(accepted).toBeUndefined()
      expect(refused).toMatchObject(violates('ai_execution_control_heads_scope_valid'))
    })
  })

  describe('ai_property_review_population_daily', () => {
    const insertDay = (fields: Record<string, unknown> = {}) => {
      const row = {
        organization_id: ORGANIZATION_ID,
        property_id: PROPERTY_ID,
        local_date: '2026-09-07',
        source_epoch: 0,
        property_profile_version: 1,
        calendar_profile_version: 'property-calendar-v1',
        review_count: 5,
        text_review_count: 2,
        rating_1_count: 1,
        rating_2_count: 1,
        rating_3_count: 1,
        rating_4_count: 1,
        rating_5_count: 1,
        population_revision: 1,
        updated_at: NOW,
        ...fields,
      }
      const columns = Object.keys(row)
      return lease.pool.query(
        `INSERT INTO ai_property_review_population_daily (${columns.join(', ')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values(row),
      )
    }

    beforeEach(async () => {
      await lease.pool.query(
        `DELETE FROM ai_property_review_population_daily WHERE organization_id = $1`,
        [ORGANIZATION_ID],
      )
    })

    it('stores a day of reviews by stars, star-only reviews included', async () => {
      await insertDay()
      await insertDay({
        local_date: '2026-09-08',
        review_count: 0,
        text_review_count: 0,
        rating_1_count: 0,
        rating_2_count: 0,
        rating_3_count: 0,
        rating_4_count: 0,
        rating_5_count: 0,
      })

      const stored = await lease.pool.query(
        `SELECT count(*)::int AS count FROM ai_property_review_population_daily WHERE organization_id = $1`,
        [ORGANIZATION_ID],
      )
      expect(stored.rows[0].count).toBe(2)
    })

    it('keeps one row per Property day and profile generation', async () => {
      await insertDay()

      await expect(
        insertDay({ review_count: 6, rating_5_count: 2 }),
      ).rejects.toMatchObject({
        code: '23505',
      })
      await insertDay({ property_profile_version: 2 })
    })

    it('refuses counts whose stars do not add up, are negative, or outnumber the reviews', async () => {
      const counts = 'ai_property_review_population_daily_counts_valid'

      await expect(insertDay({ rating_5_count: 2 })).rejects.toMatchObject(
        violates(counts),
      )
      await expect(insertDay({ text_review_count: 6 })).rejects.toMatchObject(
        violates(counts),
      )
      await expect(
        insertDay({ rating_1_count: -1, rating_2_count: 3 }),
      ).rejects.toMatchObject(violates(counts))
      await expect(
        insertDay({ review_count: -5, text_review_count: -5 }),
      ).rejects.toMatchObject(violates(counts))
    })

    it('refuses a revision below 1, an empty calendar profile and a negative epoch', async () => {
      const versions = 'ai_property_review_population_daily_versions_valid'

      await expect(insertDay({ population_revision: 0 })).rejects.toMatchObject(
        violates(versions),
      )
      await expect(insertDay({ calendar_profile_version: '' })).rejects.toMatchObject(
        violates(versions),
      )
      await expect(insertDay({ source_epoch: -1 })).rejects.toMatchObject(
        violates(versions),
      )
      await expect(insertDay({ property_profile_version: 0 })).rejects.toMatchObject(
        violates(versions),
      )
    })

    it('belongs to a Property of the same Organization and goes with it', async () => {
      await expect(
        insertDay({ organization_id: 'another-organization' }),
      ).rejects.toMatchObject({ code: '23503' })

      await insertDay()
      const error = await inRolledBackTransaction(async (client) => {
        await client.query(`DELETE FROM properties WHERE id = $1`, [PROPERTY_ID])
        const left = await client.query(
          `SELECT count(*)::int AS count FROM ai_property_review_population_daily WHERE property_id = $1`,
          [PROPERTY_ID],
        )
        expect(left.rows[0].count).toBe(0)
      })
      expect(error).toBeUndefined()
    })
  })

  describe('properties.google_primary_category', () => {
    const setCategory = (category: string | null, updatedAt: Date | null) =>
      lease.pool.query(
        `UPDATE properties SET google_primary_category = $1, google_primary_category_updated_at = $2
         WHERE id = $3`,
        [category, updatedAt, PROPERTY_ID],
      )

    it('stores Google’s display name with the instant it was read, or nothing', async () => {
      await setCategory('Italian restaurant', NOW)
      await setCategory(null, NOW)
      await setCategory(null, null)

      const row = (
        await lease.pool.query(
          `SELECT google_primary_category, google_primary_category_updated_at FROM properties WHERE id = $1`,
          [PROPERTY_ID],
        )
      ).rows[0]
      expect(row).toEqual({
        google_primary_category: null,
        google_primary_category_updated_at: null,
      })
    })

    it('refuses an empty, untrimmed or unstamped category', async () => {
      const check = 'properties_google_primary_category_valid'

      await expect(setCategory('', NOW)).rejects.toMatchObject(violates(check))
      await expect(setCategory(' Hotel', NOW)).rejects.toMatchObject(violates(check))
      await expect(setCategory('Hotel ', NOW)).rejects.toMatchObject(violates(check))
      await expect(setCategory('Hotel', null)).rejects.toMatchObject(violates(check))
    })

    it('holds a category to 512 characters', async () => {
      await setCategory('H'.repeat(512), NOW)

      await expect(setCategory('H'.repeat(513), NOW)).rejects.toMatchObject({
        code: '22001',
      })
      await setCategory(null, null)
    })
  })
})
