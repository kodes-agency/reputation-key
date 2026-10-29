// Review Analysis v3 storage (migration 0078): what an analysis says about a
// review as twelve topics with a cause and the sentences that state it, the
// same mentions again under the Property's aggregate contribution, and the
// daily count of every review by stars. Nothing here holds a quote, a sentence,
// a name or a provider response (ADR 0031); a sentence is only a number the live
// display resolves against the original text, read through Review.
//
// The vocabularies are the shared v3 contract's (`review-analysis-v3.ts`), so
// the database and the normalizer cannot name different topics or strengths.
// Every row is a derivative that expires with its analysis (24 months, ADR
// 0031): the two mention tables and the sentence table cascade from
// `ai_review_analyses` and `ai_property_aggregate_contributions`, which the
// retention sweep deletes on `expires_at`; the daily counts have their own rule.

import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import {
  REVIEW_ANALYSIS_V3_MAX_MENTIONS,
  REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER,
  REVIEW_CAUSE_PHRASE_PATTERN,
  REVIEW_NAMES_PERSON_V3,
  REVIEW_POLARITIES_V3,
  REVIEW_STRENGTHS_V3,
} from '../../review-analysis-v3'
import { REVIEW_TOPICS_V3 } from '../../review-topic-taxonomy'
import { aiPropertyAggregateContributions, aiReviewAnalyses } from './ai.schema'
import {
  propertyTenantForeignKey,
  sqlPatternLiteral,
  sqlStringList,
  timestamptz,
} from './ai-schema-helpers'

const SAFE_INTEGER_MAX = sql.raw("'9007199254740991'::bigint")
const CAUSE_PATTERN = sqlPatternLiteral(REVIEW_CAUSE_PHRASE_PATTERN.source)

/** The analysis key plus the mention's place in the answer; both mention tables carry it. */
const mentionColumns = () => ({
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  propertyId: uuid('property_id').notNull(),
  reviewId: uuid('review_id').notNull(),
  sourceEpoch: integer('source_epoch').notNull(),
  sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
  analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
  mentionOrdinal: smallint('mention_ordinal').notNull(),
  topic: varchar('topic', { length: 40 }).notNull(),
  polarity: varchar('polarity', { length: 10 }).notNull(),
  strength: varchar('strength', { length: 10 }).notNull(),
  thing: varchar('thing', { length: 80 }),
  issue: varchar('issue', { length: 80 }),
  namesPerson: varchar('names_person', { length: 20 }),
})

type MentionColumns = Readonly<
  Record<keyof ReturnType<typeof mentionColumns>, AnyPgColumn>
>

const analysisKey = (t: MentionColumns) =>
  [
    t.organizationId,
    t.propertyId,
    t.reviewId,
    t.sourceEpoch,
    t.sourceRevision,
    t.analysisSequence,
  ] as const

/** The row checks and the identity index both mention tables share. */
function mentionRules(t: MentionColumns, prefix: string) {
  return [
    check(
      `${prefix}_values_valid`,
      sql`${t.sourceEpoch} >= 0 AND ${t.sourceRevision} BETWEEN 1 AND ${SAFE_INTEGER_MAX} AND ${t.analysisSequence} BETWEEN 1 AND ${SAFE_INTEGER_MAX}
        AND ${t.mentionOrdinal} BETWEEN 0 AND ${sql.raw(String(REVIEW_ANALYSIS_V3_MAX_MENTIONS - 1))}
        AND ${t.topic} IN (${sqlStringList(REVIEW_TOPICS_V3)})
        AND ${t.polarity} IN (${sqlStringList(REVIEW_POLARITIES_V3)})
        AND ${t.strength} IN (${sqlStringList(REVIEW_STRENGTHS_V3)})
        AND (${t.namesPerson} IS NULL OR ${t.namesPerson} IN (${sqlStringList(REVIEW_NAMES_PERSON_V3)}))`,
    ),
    check(
      `${prefix}_cause_valid`,
      sql`(${t.thing} IS NULL OR ${t.thing} ~ ${CAUSE_PATTERN})
        AND (${t.issue} IS NULL OR ${t.issue} ~ ${CAUSE_PATTERN})
        AND (${t.issue} IS NOT NULL OR ${t.thing} IS NULL)`,
    ),
    // The same cause under one topic and polarity is one mention. `coalesce`
    // lets a topic-level mention (no thing) take part in the rule.
    uniqueIndex(`${prefix}_identity_unique`).on(
      t.organizationId,
      t.propertyId,
      t.reviewId,
      t.sourceEpoch,
      t.sourceRevision,
      t.analysisSequence,
      t.topic,
      sql`coalesce(${t.thing}, '')`,
      t.polarity,
    ),
  ]
}

export const aiReviewAnalysisMentions = pgTable(
  'ai_review_analysis_mentions',
  mentionColumns(),
  (t) => [
    primaryKey({
      columns: [...analysisKey(t), t.mentionOrdinal],
      name: 'ai_review_analysis_mentions_pk',
    }),
    foreignKey({
      columns: [...analysisKey(t)],
      foreignColumns: [
        aiReviewAnalyses.organizationId,
        aiReviewAnalyses.propertyId,
        aiReviewAnalyses.reviewId,
        aiReviewAnalyses.sourceEpoch,
        aiReviewAnalyses.sourceRevision,
        aiReviewAnalyses.analysisSequence,
      ],
      name: 'ai_review_analysis_mentions_analysis_fk',
    }).onDelete('cascade'),
    ...mentionRules(t, 'ai_review_analysis_mentions'),
  ],
)

/**
 * The one-based sentence numbers that state a mention
 * (`review-sentences.ts`). A mention cites at least one and at most 16; a row
 * cannot say that, so the writer does.
 */
export const aiReviewAnalysisMentionSentences = pgTable(
  'ai_review_analysis_mention_sentences',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
    mentionOrdinal: smallint('mention_ordinal').notNull(),
    sentenceNumber: integer('sentence_number').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.reviewId,
        t.sourceEpoch,
        t.sourceRevision,
        t.analysisSequence,
        t.mentionOrdinal,
        t.sentenceNumber,
      ],
      name: 'ai_review_analysis_mention_sentences_pk',
    }),
    foreignKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.reviewId,
        t.sourceEpoch,
        t.sourceRevision,
        t.analysisSequence,
        t.mentionOrdinal,
      ],
      foreignColumns: [
        aiReviewAnalysisMentions.organizationId,
        aiReviewAnalysisMentions.propertyId,
        aiReviewAnalysisMentions.reviewId,
        aiReviewAnalysisMentions.sourceEpoch,
        aiReviewAnalysisMentions.sourceRevision,
        aiReviewAnalysisMentions.analysisSequence,
        aiReviewAnalysisMentions.mentionOrdinal,
      ],
      name: 'ai_review_analysis_mention_sentences_mention_fk',
    }).onDelete('cascade'),
    check(
      'ai_review_analysis_mention_sentences_number_valid',
      sql`${t.sentenceNumber} BETWEEN 1 AND ${sql.raw(String(REVIEW_ANALYSIS_V3_MAX_SENTENCE_NUMBER))}`,
    ),
  ],
)

/**
 * The effective aggregation input: the analysis's mentions again, under the
 * contribution that retracts with it. Guest voice 2.0 counts from these rows.
 */
export const aiPropertyAggregateContributionMentions = pgTable(
  'ai_property_aggregate_contribution_mentions',
  mentionColumns(),
  (t) => [
    primaryKey({
      columns: [...analysisKey(t), t.mentionOrdinal],
      name: 'ai_property_aggregate_contribution_mentions_pk',
    }),
    foreignKey({
      columns: [...analysisKey(t)],
      foreignColumns: [
        aiPropertyAggregateContributions.organizationId,
        aiPropertyAggregateContributions.propertyId,
        aiPropertyAggregateContributions.reviewId,
        aiPropertyAggregateContributions.sourceEpoch,
        aiPropertyAggregateContributions.sourceRevision,
        aiPropertyAggregateContributions.analysisSequence,
      ],
      name: 'ai_property_aggregate_contribution_mentions_contribution_fk',
    }).onDelete('cascade'),
    ...mentionRules(t, 'ai_property_aggregate_contribution_mentions'),
  ],
)

/**
 * How many reviews a Property received on a local day, by stars: the
 * denominator of Guest voice's "worth up to about 0.2 stars", star-only
 * reviews included. A count has no review identity, quote or name. It is kept
 * 24 UTC calendar months from the day it counts (`local_date`), never from its
 * last update.
 */
export const aiPropertyReviewPopulationDaily = pgTable(
  'ai_property_review_population_daily',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    propertyProfileVersion: integer('property_profile_version').notNull(),
    calendarProfileVersion: varchar('calendar_profile_version', {
      length: 100,
    }).notNull(),
    reviewCount: integer('review_count').notNull(),
    textReviewCount: integer('text_review_count').notNull(),
    rating1Count: integer('rating_1_count').notNull(),
    rating2Count: integer('rating_2_count').notNull(),
    rating3Count: integer('rating_3_count').notNull(),
    rating4Count: integer('rating_4_count').notNull(),
    rating5Count: integer('rating_5_count').notNull(),
    populationRevision: bigint('population_revision', { mode: 'number' }).notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.organizationId,
        t.propertyId,
        t.sourceEpoch,
        t.propertyProfileVersion,
        t.localDate,
      ],
      name: 'ai_property_review_population_daily_pk',
    }),
    propertyTenantForeignKey(t, 'ai_property_review_population_daily_tenant_fk'),
    check(
      'ai_property_review_population_daily_versions_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.propertyProfileVersion} >= 1 AND char_length(${t.calendarProfileVersion}) BETWEEN 1 AND 100 AND ${t.populationRevision} BETWEEN 1 AND ${SAFE_INTEGER_MAX}`,
    ),
    check(
      'ai_property_review_population_daily_counts_valid',
      sql`${t.reviewCount} >= 0 AND ${t.textReviewCount} >= 0 AND ${t.textReviewCount} <= ${t.reviewCount}
        AND ${t.rating1Count} >= 0 AND ${t.rating2Count} >= 0 AND ${t.rating3Count} >= 0 AND ${t.rating4Count} >= 0 AND ${t.rating5Count} >= 0
        AND ${t.rating1Count} + ${t.rating2Count} + ${t.rating3Count} + ${t.rating4Count} + ${t.rating5Count} = ${t.reviewCount}`,
    ),
    // The retention sweep's batches read the oldest days first.
    index('ai_property_review_population_daily_retention_idx').on(t.localDate),
  ],
)
