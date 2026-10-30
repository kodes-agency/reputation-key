// The mentions of a v3 review analysis in storage (migration 0078): one row per
// mention in `ai_review_analysis_mentions`, the sentence numbers it cites in
// `ai_review_analysis_mention_sentences`, and the same mentions copied under the
// Property's aggregate contribution. A row holds a topic, a polarity, a strength,
// the optional cause and whether a person is named; it never holds review text,
// a sentence or a name. A mention's place in the answer is its ordinal.

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributionMentions,
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
  table: typeof aiReviewAnalysisMentions | typeof aiReviewAnalysisMentionSentences,
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
 * The mentions of one analysis, in answer order, each with the sentence numbers
 * it cites. A row the checks of 0078 would have refused is an invariant breach
 * and throws, like every other stored derivative that fails to read back.
 */
async function readAnalysisMentions(
  tx: Transaction,
  key: AnalysisKey,
): Promise<readonly ReviewAnalysisMentionV3[]> {
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
        topic: row.topic,
        polarity,
        strength,
        thing: row.thing,
        issue: row.issue,
        sentences: Object.freeze(sentences),
        namesPerson: oneOf(REVIEW_NAMES_PERSON_V3, row.namesPerson),
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
