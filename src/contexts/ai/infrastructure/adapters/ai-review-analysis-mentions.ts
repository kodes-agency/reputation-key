// The mentions of a v3 review analysis in storage (migration 0078): one row per
// mention in `ai_review_analysis_mentions`, the sentence numbers it cites in
// `ai_review_analysis_mention_sentences`, and the same mentions copied under the
// Property's aggregate contribution. A row holds a topic, a polarity, a strength,
// the optional cause and whether a person is named; it never holds review text,
// a sentence or a name. A mention's place in the answer is its ordinal.

import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributionMentions,
  aiReviewAnalysisMentionCorrections,
  aiReviewAnalysisMentionSentences,
  aiReviewAnalysisMentions,
} from '#/shared/db/schema'
import {
  REVIEW_ANALYSIS_V3_MAX_MENTIONS,
  REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS,
  REVIEW_NAMES_PERSON_V3,
  REVIEW_POLARITIES_V3,
  REVIEW_STRENGTHS_V3,
} from '#/shared/review-analysis-v3'
import { isReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import {
  REVIEW_ATTENTION_LEVELS_V2,
  REVIEW_SENTIMENTS_V3,
  REVIEW_URGENT_REASONS_V3,
} from '#/shared/review-analysis-v3'
import type {
  ReviewAnalysisCurrentnessV1,
  ReviewAnalysisMentionCorrectionV3,
  ReviewAnalysisMentionReadV3,
  ReviewAnalysisMentionV3,
  ReviewAnalysisReadV1,
} from '../../domain/types'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** The key one analysis (and its mentions) is filed under. */
export type AnalysisKey = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
}>

/** Writes the mentions of a new analysis, in the order the answer gave them. */
export async function insertAnalysisMentions(
  tx: Transaction,
  key: AnalysisKey,
  mentions: readonly ReviewAnalysisMentionV3[],
): Promise<void> {
  if (mentions.length === 0) return
  await tx.insert(aiReviewAnalysisMentions).values(
    mentions.map((mention, ordinal) => ({
      ...key,
      mentionOrdinal: ordinal,
      topic: mention.topic,
      polarity: mention.polarity,
      strength: mention.strength,
      thing: mention.thing,
      issue: mention.issue,
      namesPerson: mention.namesPerson,
    })),
  )
  await tx.insert(aiReviewAnalysisMentionSentences).values(
    mentions.flatMap((mention, ordinal) =>
      mention.sentences.map((sentenceNumber) => ({
        ...key,
        mentionOrdinal: ordinal,
        sentenceNumber,
      })),
    ),
  )
}

function keyMatches(
  table:
    | typeof aiReviewAnalysisMentions
    | typeof aiReviewAnalysisMentionSentences
    | typeof aiReviewAnalysisMentionCorrections,
  key: AnalysisKey,
) {
  return and(
    eq(table.organizationId, key.organizationId),
    eq(table.propertyId, key.propertyId),
    eq(table.reviewId, key.reviewId),
    eq(table.sourceEpoch, key.sourceEpoch),
    eq(table.sourceRevision, key.sourceRevision),
    eq(table.analysisSequence, key.analysisSequence),
  )
}

function oneOf<Value extends string>(
  allowed: readonly Value[],
  value: string | null,
): Value | null {
  return allowed.find((candidate) => candidate === value) ?? null
}

/**
 * The issue each mention belongs to now, by its place in the answer: the issue a manager
 * moved a changed cause to, else the one the mention was assigned, in both cases followed
 * through a merge once. Null for a mention written before grouping.
 */
async function readEffectiveIssueGroups(
  tx: Transaction,
  key: AnalysisKey,
): Promise<ReadonlyMap<number, string | null>> {
  const result = await tx.execute<{ ordinal: number; issueGroupId: string | null }>(sql`
    SELECT
      mention.mention_ordinal AS ordinal,
      CASE WHEN correction.kind = 'change_cause'
        THEN COALESCE(replacement_group.merged_into_issue_id, correction.replacement_issue_group_id)
        ELSE COALESCE(issue_group.merged_into_issue_id, mention.issue_group_id) END::text AS "issueGroupId"
    FROM ai_property_aggregate_contribution_mentions AS mention
    LEFT JOIN ai_property_issue_groups AS issue_group
      ON issue_group.organization_id = mention.organization_id
     AND issue_group.property_id = mention.property_id
     AND issue_group.id = mention.issue_group_id
    LEFT JOIN ai_review_analysis_mention_corrections AS correction
      ON correction.organization_id = mention.organization_id
     AND correction.property_id = mention.property_id
     AND correction.review_id = mention.review_id
     AND correction.source_epoch = mention.source_epoch
     AND correction.source_revision = mention.source_revision
     AND correction.analysis_sequence = mention.analysis_sequence
     AND correction.mention_ordinal = mention.mention_ordinal
    LEFT JOIN ai_property_issue_groups AS replacement_group
      ON replacement_group.organization_id = correction.organization_id
     AND replacement_group.property_id = correction.property_id
     AND replacement_group.id = correction.replacement_issue_group_id
    WHERE mention.organization_id = ${key.organizationId}
      AND mention.property_id = ${key.propertyId}::uuid
      AND mention.review_id = ${key.reviewId}::uuid
      AND mention.source_epoch = ${key.sourceEpoch}
      AND mention.source_revision = ${key.sourceRevision}
      AND mention.analysis_sequence = ${key.analysisSequence}
  `)
  return new Map(result.rows.map((row) => [Number(row.ordinal), row.issueGroupId]))
}

async function readCorrections(
  tx: Transaction,
  key: AnalysisKey,
): Promise<ReadonlyMap<number, ReviewAnalysisMentionCorrectionV3>> {
  const rows = await tx
    .select({
      ordinal: aiReviewAnalysisMentionCorrections.mentionOrdinal,
      kind: aiReviewAnalysisMentionCorrections.kind,
      thing: aiReviewAnalysisMentionCorrections.replacementThing,
      issue: aiReviewAnalysisMentionCorrections.replacementIssue,
      updatedAt: aiReviewAnalysisMentionCorrections.updatedAt,
    })
    .from(aiReviewAnalysisMentionCorrections)
    .where(keyMatches(aiReviewAnalysisMentionCorrections, key))
    .for('share')
  const corrections = new Map<number, ReviewAnalysisMentionCorrectionV3>()
  for (const row of rows) {
    const correctedAtEpochMillis = row.updatedAt.getTime()
    if (row.kind === 'remove_topic' || row.kind === 'not_a_problem') {
      corrections.set(row.ordinal, { kind: row.kind, correctedAtEpochMillis })
    } else if (row.kind === 'change_cause') {
      corrections.set(row.ordinal, {
        kind: 'change_cause',
        thing: row.thing,
        issue: row.issue,
        correctedAtEpochMillis,
      })
    } else {
      throw new Error('Review analysis correction has an unknown kind')
    }
  }
  return corrections
}

/**
 * The mentions of one analysis, in answer order, each with the sentence numbers
 * it cites, the issue it belongs to and a manager's correction beside it. A row the
 * checks of 0078 would have refused is an invariant breach and throws, like every other
 * stored derivative that fails to read back.
 */
async function readAnalysisMentions(
  tx: Transaction,
  key: AnalysisKey,
): Promise<readonly ReviewAnalysisMentionReadV3[]> {
  const rows = await tx
    .select({
      ordinal: aiReviewAnalysisMentions.mentionOrdinal,
      topic: aiReviewAnalysisMentions.topic,
      polarity: aiReviewAnalysisMentions.polarity,
      strength: aiReviewAnalysisMentions.strength,
      thing: aiReviewAnalysisMentions.thing,
      issue: aiReviewAnalysisMentions.issue,
      namesPerson: aiReviewAnalysisMentions.namesPerson,
    })
    .from(aiReviewAnalysisMentions)
    .where(keyMatches(aiReviewAnalysisMentions, key))
    .orderBy(asc(aiReviewAnalysisMentions.mentionOrdinal))
    .for('share')
  const cited = await tx
    .select({
      ordinal: aiReviewAnalysisMentionSentences.mentionOrdinal,
      sentenceNumber: aiReviewAnalysisMentionSentences.sentenceNumber,
    })
    .from(aiReviewAnalysisMentionSentences)
    .where(keyMatches(aiReviewAnalysisMentionSentences, key))
    .orderBy(
      asc(aiReviewAnalysisMentionSentences.mentionOrdinal),
      asc(aiReviewAnalysisMentionSentences.sentenceNumber),
    )
    .for('share')
  const groups = await readEffectiveIssueGroups(tx, key)
  const corrections = await readCorrections(tx, key)
  if (rows.length > REVIEW_ANALYSIS_V3_MAX_MENTIONS) {
    throw new Error('Ready v3 analysis has too many mentions')
  }
  return Object.freeze(
    rows.map((row) => {
      const sentences = cited
        .filter((citation) => citation.ordinal === row.ordinal)
        .map((citation) => citation.sentenceNumber)
      const polarity = oneOf(REVIEW_POLARITIES_V3, row.polarity)
      const strength = oneOf(REVIEW_STRENGTHS_V3, row.strength)
      if (
        !isReviewTopicV3(row.topic) ||
        polarity === null ||
        strength === null ||
        (row.namesPerson !== null &&
          oneOf(REVIEW_NAMES_PERSON_V3, row.namesPerson) === null) ||
        sentences.length < 1 ||
        sentences.length > REVIEW_ANALYSIS_V3_MAX_SENTENCE_REFS
      ) {
        throw new Error('Ready v3 analysis mention is invalid')
      }
      return Object.freeze({
        mentionOrdinal: row.ordinal,
        topic: row.topic,
        polarity,
        strength,
        thing: row.thing,
        issue: row.issue,
        sentences: Object.freeze(sentences),
        namesPerson: oneOf(REVIEW_NAMES_PERSON_V3, row.namesPerson),
        issueGroupId: groups.get(row.ordinal) ?? null,
        correction: corrections.get(row.ordinal) ?? null,
      })
    }),
  )
}

/**
 * Files the analysis's mentions again under the aggregate contribution built from
 * it, the effective input of every statistic. The contribution row exists
 * already; the mentions retract with it (the foreign key cascades).
 */
export async function copyMentionsToContribution(
  tx: Transaction,
  key: AnalysisKey,
): Promise<number> {
  const copied = await tx
    .insert(aiPropertyAggregateContributionMentions)
    .select(
      tx
        .select({
          organizationId: aiReviewAnalysisMentions.organizationId,
          propertyId: aiReviewAnalysisMentions.propertyId,
          reviewId: aiReviewAnalysisMentions.reviewId,
          sourceEpoch: aiReviewAnalysisMentions.sourceEpoch,
          sourceRevision: aiReviewAnalysisMentions.sourceRevision,
          analysisSequence: aiReviewAnalysisMentions.analysisSequence,
          mentionOrdinal: aiReviewAnalysisMentions.mentionOrdinal,
          topic: aiReviewAnalysisMentions.topic,
          polarity: aiReviewAnalysisMentions.polarity,
          strength: aiReviewAnalysisMentions.strength,
          thing: aiReviewAnalysisMentions.thing,
          issue: aiReviewAnalysisMentions.issue,
          namesPerson: aiReviewAnalysisMentions.namesPerson,
          issueGroupId: sql<string | null>`NULL::uuid`.as('issue_group_id'),
        })
        .from(aiReviewAnalysisMentions)
        .where(keyMatches(aiReviewAnalysisMentions, key)),
    )
    .returning({ ordinal: aiPropertyAggregateContributionMentions.mentionOrdinal })
  return copied.length
}

/**
 * A ready v3 analysis as the Inbox reads it back: the stored root and its
 * mentions. The root's own checks tie the attention to the urgent reason; this
 * re-asserts them so a row that bypassed them cannot be delivered.
 */
export async function readReadyAnalysisV3(
  tx: Transaction,
  key: AnalysisKey,
  currentness: ReviewAnalysisCurrentnessV1,
  root: Readonly<{
    sentiment: string | null
    attention: string | null
    urgentReason: string | null
    generatedAt: Date
  }>,
): Promise<ReviewAnalysisReadV1> {
  const sentiment = oneOf(REVIEW_SENTIMENTS_V3, root.sentiment)
  const attention = oneOf(REVIEW_ATTENTION_LEVELS_V2, root.attention)
  const urgentReason =
    root.urgentReason === null ? null : oneOf(REVIEW_URGENT_REASONS_V3, root.urgentReason)
  if (
    sentiment === null ||
    attention === null ||
    (root.urgentReason !== null && urgentReason === null) ||
    (attention === 'urgent') !== (urgentReason !== null)
  ) {
    throw new Error('Ready v3 analysis row is incomplete')
  }
  return {
    status: 'ready_v3',
    ...currentness,
    sentiment,
    attention,
    urgentReason,
    mentions: await readAnalysisMentions(tx, key),
    generatedAtEpochMillis: root.generatedAt.getTime(),
  }
}
