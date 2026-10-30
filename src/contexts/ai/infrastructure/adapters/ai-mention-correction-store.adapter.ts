// Drizzle persistence for a manager's corrections to a v3 analysis (migration 0080). The
// analysis is never touched: a correction is one row beside a mention, which the reads
// overlay before they count. Every write takes the same Property advisory lock as the
// aggregate writers and the issue commands, because a changed cause may create the issue
// it moves to, and checks in the same transaction that the analysis is still the review's
// current one under the fences the caller read them at.
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiReviewAnalysisMentionCorrections,
  aiReviewAnalysisMentions,
} from '#/shared/db/schema'
import { isReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type {
  AiMentionCorrectionStorePort,
  ApplyMentionCorrectionInput,
  MentionCorrectionAnalysisKey,
  MentionCorrectionFences,
} from '../../application/ports/ai-mention-correction-store.port'
import { resolveIssueGroupForThing } from './ai-issue-group-assignment'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

async function lockProperty(
  tx: Transaction,
  key: MentionCorrectionAnalysisKey,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${key.organizationId} || ':' || ${key.propertyId}::text, 0)
    )
  `)
}

/**
 * When the analysis stops being kept (its stamped deadline), if it is the review's
 * current ready v3 analysis under the fences: the latest contribution of the review, in
 * the epochs and profile the caller read, with an operation that completed. Null
 * otherwise, and then nothing is written.
 */
async function readCurrentExpiry(
  tx: Transaction,
  key: MentionCorrectionAnalysisKey,
  fences: MentionCorrectionFences,
): Promise<Date | null> {
  const result = await tx.execute<{ expiresAt: Date }>(sql`
    SELECT analysis.expires_at AS "expiresAt"
    FROM ai_review_analyses AS analysis
    INNER JOIN ai_operations AS operation ON operation.id = analysis.operation_id
    INNER JOIN ai_property_aggregate_contributions AS contribution
      ON contribution.organization_id = analysis.organization_id
     AND contribution.property_id = analysis.property_id
     AND contribution.review_id = analysis.review_id
     AND contribution.source_epoch = analysis.source_epoch
     AND contribution.source_revision = analysis.source_revision
     AND contribution.analysis_sequence = analysis.analysis_sequence
    WHERE analysis.organization_id = ${key.organizationId}
      AND analysis.property_id = ${key.propertyId}::uuid
      AND analysis.review_id = ${key.reviewId}::uuid
      AND analysis.source_epoch = ${key.sourceEpoch}
      AND analysis.source_revision = ${key.sourceRevision}
      AND analysis.analysis_sequence = ${key.analysisSequence}
      AND analysis.status = 'ready'
      AND analysis.analysis_profile_version = 'review-analysis-v3'
      AND operation.state IN ('succeeded_pending_delivery', 'succeeded')
      AND contribution.status = 'ready'
      AND contribution.review_analysis_epoch = ${fences.reviewAnalysisEpoch}
      AND contribution.property_profile_version = ${fences.propertyProfileVersion}
      AND NOT EXISTS (
        SELECT 1
        FROM ai_property_aggregate_contributions AS newer
        WHERE newer.organization_id = contribution.organization_id
          AND newer.property_id = contribution.property_id
          AND newer.review_id = contribution.review_id
          AND newer.source_epoch = contribution.source_epoch
          AND newer.review_analysis_epoch = contribution.review_analysis_epoch
          AND newer.property_profile_version = contribution.property_profile_version
          AND newer.analysis_sequence > contribution.analysis_sequence
      )
  `)
  const row = result.rows[0]
  return row === undefined ? null : new Date(row.expiresAt)
}

type StoredMention = Readonly<{
  ordinal: number
  topic: string
  polarity: string
}>

async function readMentions(
  tx: Transaction,
  key: MentionCorrectionAnalysisKey,
): Promise<readonly StoredMention[]> {
  return tx
    .select({
      ordinal: aiReviewAnalysisMentions.mentionOrdinal,
      topic: aiReviewAnalysisMentions.topic,
      polarity: aiReviewAnalysisMentions.polarity,
    })
    .from(aiReviewAnalysisMentions)
    .where(
      and(
        eq(aiReviewAnalysisMentions.organizationId, key.organizationId),
        eq(aiReviewAnalysisMentions.propertyId, key.propertyId),
        eq(aiReviewAnalysisMentions.reviewId, key.reviewId),
        eq(aiReviewAnalysisMentions.sourceEpoch, key.sourceEpoch),
        eq(aiReviewAnalysisMentions.sourceRevision, key.sourceRevision),
        eq(aiReviewAnalysisMentions.analysisSequence, key.analysisSequence),
      ),
    )
    .orderBy(aiReviewAnalysisMentions.mentionOrdinal)
}

function correctionKeyMatches(key: MentionCorrectionAnalysisKey) {
  return and(
    eq(aiReviewAnalysisMentionCorrections.organizationId, key.organizationId),
    eq(aiReviewAnalysisMentionCorrections.propertyId, key.propertyId),
    eq(aiReviewAnalysisMentionCorrections.reviewId, key.reviewId),
    eq(aiReviewAnalysisMentionCorrections.sourceEpoch, key.sourceEpoch),
    eq(aiReviewAnalysisMentionCorrections.sourceRevision, key.sourceRevision),
    eq(aiReviewAnalysisMentionCorrections.analysisSequence, key.analysisSequence),
  )
}

/** The mentions a command reaches: the one named, or every one of its topic when removed. */
function reachedOrdinals(
  mentions: readonly StoredMention[],
  target: StoredMention,
  kind: ApplyMentionCorrectionInput['command']['kind'],
): readonly number[] {
  return kind === 'remove_topic'
    ? mentions.filter((mention) => mention.topic === target.topic).map((m) => m.ordinal)
    : [target.ordinal]
}

async function replacementGroup(
  tx: Transaction,
  input: ApplyMentionCorrectionInput,
  topic: string,
  expiresAt: Date,
): Promise<string | null> {
  if (input.command.kind !== 'change_cause') return null
  if (!isReviewTopicV3(topic))
    throw new Error('Review analysis mention has an unknown topic')
  return resolveIssueGroupForThing(
    tx,
    input.key,
    topic,
    input.command.thing,
    input.correctedAt,
    expiresAt,
  )
}

export function createAiMentionCorrectionStoreAdapter(
  db: Database,
): AiMentionCorrectionStorePort {
  return {
    apply: (input) =>
      db.transaction(async (tx) => {
        await lockProperty(tx, input.key)
        const expiresAt = await readCurrentExpiry(tx, input.key, input.fences)
        if (expiresAt === null) return { status: 'not_found' }
        const mentions = await readMentions(tx, input.key)
        const target = mentions.find(
          (mention) => mention.ordinal === input.mentionOrdinal,
        )
        if (target === undefined) return { status: 'not_found' }
        // "Not a problem" is said of a complaint; of praise or a neutral remark it means nothing.
        if (input.command.kind === 'not_a_problem' && target.polarity !== 'negative') {
          return { status: 'not_applicable' }
        }

        const ordinals = reachedOrdinals(mentions, target, input.command.kind)
        const groupId = await replacementGroup(tx, input, target.topic, expiresAt)
        const changed = input.command.kind === 'change_cause' ? input.command : null
        await tx
          .insert(aiReviewAnalysisMentionCorrections)
          .values(
            ordinals.map((ordinal) => ({
              ...input.key,
              mentionOrdinal: ordinal,
              topic: target.topic,
              kind: input.command.kind,
              replacementThing: changed?.thing ?? null,
              replacementIssue: changed?.issue ?? null,
              replacementIssueGroupId: groupId,
              correctedBy: input.correctedBy,
              createdAt: input.correctedAt,
              updatedAt: input.correctedAt,
            })),
          )
          .onConflictDoUpdate({
            target: [
              aiReviewAnalysisMentionCorrections.organizationId,
              aiReviewAnalysisMentionCorrections.propertyId,
              aiReviewAnalysisMentionCorrections.reviewId,
              aiReviewAnalysisMentionCorrections.sourceEpoch,
              aiReviewAnalysisMentionCorrections.sourceRevision,
              aiReviewAnalysisMentionCorrections.analysisSequence,
              aiReviewAnalysisMentionCorrections.mentionOrdinal,
            ],
            set: {
              topic: sql`excluded.topic`,
              kind: sql`excluded.kind`,
              replacementThing: sql`excluded.replacement_thing`,
              replacementIssue: sql`excluded.replacement_issue`,
              replacementIssueGroupId: sql`excluded.replacement_issue_group_id`,
              correctedBy: sql`excluded.corrected_by`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
        return { status: 'applied', mentionOrdinals: ordinals }
      }),

    clear: (input) =>
      db.transaction(async (tx) => {
        await lockProperty(tx, input.key)
        if ((await readCurrentExpiry(tx, input.key, input.fences)) === null) {
          return { status: 'not_found' }
        }
        const [existing] = await tx
          .select({
            kind: aiReviewAnalysisMentionCorrections.kind,
            topic: aiReviewAnalysisMentionCorrections.topic,
          })
          .from(aiReviewAnalysisMentionCorrections)
          .where(
            and(
              correctionKeyMatches(input.key),
              eq(aiReviewAnalysisMentionCorrections.mentionOrdinal, input.mentionOrdinal),
            ),
          )
          .limit(1)
        if (existing === undefined) return { status: 'not_found' }

        // A removed topic comes back whole, as it went.
        const mentions = await readMentions(tx, input.key)
        const reached =
          existing.kind === 'remove_topic'
            ? mentions
                .filter((mention) => mention.topic === existing.topic)
                .map((mention) => mention.ordinal)
            : [input.mentionOrdinal]
        const removed = await tx
          .delete(aiReviewAnalysisMentionCorrections)
          .where(
            and(
              correctionKeyMatches(input.key),
              inArray(aiReviewAnalysisMentionCorrections.mentionOrdinal, [...reached]),
              eq(aiReviewAnalysisMentionCorrections.kind, existing.kind),
            ),
          )
          .returning({ ordinal: aiReviewAnalysisMentionCorrections.mentionOrdinal })
        return {
          status: 'cleared',
          mentionOrdinals: removed.map((row) => row.ordinal).sort((a, b) => a - b),
        }
      }),
  }
}
