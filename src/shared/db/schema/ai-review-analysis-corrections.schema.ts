// Manager corrections to a review's v3 analysis (migration 0080). The analysis is the
// provider's answer and stays as it was written; a correction is a manager's word beside
// it, one row per mention at most. The read overlays it before anything is counted, so a
// correction changes what Guest voice and the Inbox show at once, and a new revision of
// the review (a new analysis, a new key) starts with none.
//
// A correction is manager input, not review content: a kind and, for a changed cause, the
// two short lowercase phrases the manager chose. It holds no quote, name or sentence. It
// expires with the analysis it sits beside (24 months, ADR 0031): the row cascades from
// the mention, which cascades from `ai_review_analyses`, which the retention sweep deletes.

import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  smallint,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import {
  REVIEW_ANALYSIS_V3_MAX_MENTIONS,
  REVIEW_CAUSE_PHRASE_PATTERN,
} from '../../review-analysis-v3'
import { REVIEW_TOPICS_V3 } from '../../review-topic-taxonomy'
import { aiPropertyIssueGroups } from './ai-property-issue-groups.schema'
import { aiReviewAnalysisMentions } from './ai-review-analysis-v3.schema'
import { sqlPatternLiteral, sqlStringList, timestamptz } from './ai-schema-helpers'

const SAFE_INTEGER_MAX = sql.raw("'9007199254740991'::bigint")
const CAUSE_PATTERN = sqlPatternLiteral(REVIEW_CAUSE_PHRASE_PATTERN.source)

/** What a manager can say is wrong with one mention. */
export const MENTION_CORRECTION_KINDS = Object.freeze([
  'remove_topic',
  'change_cause',
  'not_a_problem',
] as const)
export type MentionCorrectionKind = (typeof MENTION_CORRECTION_KINDS)[number]

export const aiReviewAnalysisMentionCorrections = pgTable(
  'ai_review_analysis_mention_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    sourceEpoch: integer('source_epoch').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    analysisSequence: bigint('analysis_sequence', { mode: 'number' }).notNull(),
    mentionOrdinal: smallint('mention_ordinal').notNull(),
    // The mention's topic, kept here so the replacement issue can be held to it by key.
    topic: varchar('topic', { length: 40 }).notNull(),
    kind: varchar('kind', { length: 30 }).notNull(),
    replacementThing: varchar('replacement_thing', { length: 80 }),
    replacementIssue: varchar('replacement_issue', { length: 80 }),
    replacementIssueGroupId: uuid('replacement_issue_group_id'),
    correctedBy: varchar('corrected_by', { length: 255 }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    // One correction per mention: a later word replaces the earlier.
    uniqueIndex('ai_review_analysis_mention_corrections_mention_unique').on(
      t.organizationId,
      t.propertyId,
      t.reviewId,
      t.sourceEpoch,
      t.sourceRevision,
      t.analysisSequence,
      t.mentionOrdinal,
    ),
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
      name: 'ai_review_analysis_mention_corrections_mention_fk',
    }).onDelete('cascade'),
    // The issue a changed cause belongs to: same Property, same topic, by key.
    foreignKey({
      columns: [t.organizationId, t.propertyId, t.replacementIssueGroupId, t.topic],
      foreignColumns: [
        aiPropertyIssueGroups.organizationId,
        aiPropertyIssueGroups.propertyId,
        aiPropertyIssueGroups.id,
        aiPropertyIssueGroups.topic,
      ],
      name: 'ai_review_analysis_mention_corrections_issue_group_fk',
    }).onDelete('cascade'),
    check(
      'ai_review_analysis_mention_corrections_values_valid',
      sql`${t.sourceEpoch} >= 0 AND ${t.sourceRevision} BETWEEN 1 AND ${SAFE_INTEGER_MAX} AND ${t.analysisSequence} BETWEEN 1 AND ${SAFE_INTEGER_MAX}
        AND ${t.mentionOrdinal} BETWEEN 0 AND ${sql.raw(String(REVIEW_ANALYSIS_V3_MAX_MENTIONS - 1))}
        AND ${t.topic} IN (${sqlStringList(REVIEW_TOPICS_V3)})
        AND char_length(${t.correctedBy}) BETWEEN 1 AND 255`,
    ),
    // A removed or "not a problem" mention carries nothing else; a changed cause names the
    // issue it moved to and at least one of its two phrases, and a thing needs its issue.
    check(
      'ai_review_analysis_mention_corrections_kind_valid',
      sql`(${t.kind} IN ('remove_topic', 'not_a_problem')
          AND ${t.replacementThing} IS NULL AND ${t.replacementIssue} IS NULL AND ${t.replacementIssueGroupId} IS NULL)
        OR (${t.kind} = 'change_cause'
          AND ${t.replacementIssueGroupId} IS NOT NULL
          AND (${t.replacementThing} IS NOT NULL OR ${t.replacementIssue} IS NOT NULL)
          AND (${t.replacementThing} IS NULL OR ${t.replacementThing} ~ ${CAUSE_PATTERN})
          AND (${t.replacementIssue} IS NULL OR ${t.replacementIssue} ~ ${CAUSE_PATTERN})
          AND (${t.replacementIssue} IS NOT NULL OR ${t.replacementThing} IS NULL))`,
    ),
    check(
      'ai_review_analysis_mention_corrections_timestamps_valid',
      sql`${t.updatedAt} >= ${t.createdAt}`,
    ),
  ],
)
