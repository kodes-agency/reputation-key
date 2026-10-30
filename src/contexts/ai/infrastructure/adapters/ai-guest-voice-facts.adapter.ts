// The AI store's side of the Guest voice 2.0 read: which reviews have a current v3
// analysis, what each says, and the issues those mentions belong to. One consistent read
// of the Property's aggregate (the head is share-locked, as the insights read does), in
// the time budget of every AI dashboard read. Content-free: no sentence leaves this file
// except as the number the analysis cited.
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { aiPropertyIssueGroups } from '#/shared/db/schema'
import type {
  AiGuestVoiceFactsPort,
  GuestVoiceFactsPeriod,
  GuestVoiceFactsScope,
  GuestVoiceMentionRef,
  GuestVoiceUnavailableReview,
} from '../../application/ports/ai-guest-voice-facts.port'
import { mentionRefKey } from '../../application/ports/ai-guest-voice-facts.port'
import type { GuestVoiceReview } from '../../application/read-models/guest-voice-v2-facts'
import { readLockedAggregateHead } from './ai-property-aggregate-coverage'
import { AI_INSIGHTS_READ_BUDGET_MS, withStatementTimeout } from './ai-read-timeout'
import {
  mapFactsRow,
  mapGroupRow,
  type FactsRow,
  type MappedFactsRow,
} from './ai-guest-voice-facts-rows'

/** The latest contribution of each review under the fences: a newer revision supersedes an older. */
function latestContributions(scope: GuestVoiceFactsScope) {
  return sql`
    SELECT DISTINCT ON (contribution.review_id) contribution.*
    FROM ai_property_aggregate_contributions AS contribution
    WHERE contribution.organization_id = ${scope.organizationId}
      AND contribution.property_id = ${scope.propertyId}::uuid
      AND contribution.source_epoch = ${scope.sourceEpoch}
      AND contribution.review_analysis_epoch = ${scope.reviewAnalysisEpoch}
      AND contribution.property_profile_version = ${scope.propertyProfileVersion}
    ORDER BY contribution.review_id, contribution.analysis_sequence DESC
  `
}

async function readHasV3(tx: Tx, scope: GuestVoiceFactsScope): Promise<boolean> {
  const result = await tx.execute<{ present: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM ai_property_aggregate_contributions AS contribution
      INNER JOIN ai_review_analyses AS analysis
        ON analysis.organization_id = contribution.organization_id
       AND analysis.property_id = contribution.property_id
       AND analysis.review_id = contribution.review_id
       AND analysis.source_epoch = contribution.source_epoch
       AND analysis.source_revision = contribution.source_revision
       AND analysis.analysis_sequence = contribution.analysis_sequence
      WHERE contribution.organization_id = ${scope.organizationId}
        AND contribution.property_id = ${scope.propertyId}::uuid
        AND contribution.source_epoch = ${scope.sourceEpoch}
        AND contribution.review_analysis_epoch = ${scope.reviewAnalysisEpoch}
        AND contribution.property_profile_version = ${scope.propertyProfileVersion}
        AND contribution.status = 'ready'
        AND analysis.analysis_profile_version = 'review-analysis-v3'
    ) AS present
  `)
  return result.rows[0]?.present === true
}

/**
 * The effective mentions of a review as JSON, in the order the answer gave them. This
 * is the one place a manager's correction will change what the page counts.
 */
function mentionsOf(contribution: ReturnType<typeof sql.raw>) {
  return sql`
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'ordinal', mention.mention_ordinal,
          'topic', mention.topic,
          'polarity', mention.polarity,
          'strength', mention.strength,
          'cause', mention.issue,
          'group', COALESCE(issue_group.merged_into_issue_id, mention.issue_group_id),
          'names', mention.names_person
        )
        ORDER BY mention.mention_ordinal
      )
      FROM ai_property_aggregate_contribution_mentions AS mention
      LEFT JOIN ai_property_issue_groups AS issue_group
        ON issue_group.organization_id = mention.organization_id
       AND issue_group.property_id = mention.property_id
       AND issue_group.id = mention.issue_group_id
      WHERE mention.organization_id = ${contribution}.organization_id
        AND mention.property_id = ${contribution}.property_id
        AND mention.review_id = ${contribution}.review_id
        AND mention.source_epoch = ${contribution}.source_epoch
        AND mention.source_revision = ${contribution}.source_revision
        AND mention.analysis_sequence = ${contribution}.analysis_sequence
    ), '[]'::jsonb)
  `
}

async function readFactsRows(
  tx: Tx,
  scope: GuestVoiceFactsScope,
  period: GuestVoiceFactsPeriod,
): Promise<readonly FactsRow[]> {
  const latest = sql.raw('latest')
  const result = await tx.execute<FactsRow>(sql`
    WITH latest AS (${latestContributions(scope)})
    SELECT
      latest.review_id::text AS "reviewId",
      latest.source_revision::float8 AS "sourceRevision",
      latest.analysis_sequence::float8 AS "analysisSequence",
      latest.local_date::text AS "localDate",
      latest.rating AS rating,
      analysis.status AS status,
      analysis.urgent_reason AS "urgentReason",
      ${mentionsOf(latest)} AS mentions
    FROM latest
    INNER JOIN ai_review_analyses AS analysis
      ON analysis.organization_id = latest.organization_id
     AND analysis.property_id = latest.property_id
     AND analysis.review_id = latest.review_id
     AND analysis.source_epoch = latest.source_epoch
     AND analysis.source_revision = latest.source_revision
     AND analysis.analysis_sequence = latest.analysis_sequence
    INNER JOIN ai_operations AS operation ON operation.id = analysis.operation_id
    WHERE latest.status = analysis.status
      AND latest.status IN ('ready', 'unavailable')
      AND latest.local_date BETWEEN ${period.startLocalDate}::date AND ${period.endLocalDate}::date
      AND operation.state IN ('succeeded_pending_delivery', 'succeeded')
      AND analysis.analysis_profile_version = 'review-analysis-v3'
    ORDER BY latest.local_date, latest.review_id
  `)
  return result.rows
}

function splitRows(
  rows: readonly FactsRow[],
  sourceEpoch: number,
): Readonly<{
  reviews: readonly GuestVoiceReview[]
  unavailable: readonly GuestVoiceUnavailableReview[]
}> {
  const reviews: GuestVoiceReview[] = []
  const unavailable: GuestVoiceUnavailableReview[] = []
  for (const row of rows) {
    const mapped: MappedFactsRow = mapFactsRow(row, sourceEpoch)
    if (mapped.kind === 'ready') reviews.push(mapped.review)
    else unavailable.push(mapped.review)
  }
  return { reviews, unavailable }
}

async function readIssueGroups(tx: Tx, scope: GuestVoiceFactsScope) {
  const rows = await tx
    .select({
      id: sql<string>`${aiPropertyIssueGroups.id}::text`,
      topic: aiPropertyIssueGroups.topic,
      canonicalThing: aiPropertyIssueGroups.canonicalThing,
      displayName: aiPropertyIssueGroups.displayName,
      hidden: sql<boolean>`${aiPropertyIssueGroups.hiddenAt} IS NOT NULL`,
    })
    .from(aiPropertyIssueGroups)
    .where(
      and(
        eq(aiPropertyIssueGroups.organizationId, scope.organizationId),
        eq(aiPropertyIssueGroups.propertyId, scope.propertyId),
        isNull(aiPropertyIssueGroups.mergedIntoIssueId),
      ),
    )
  return rows.map(mapGroupRow)
}

function wantedMentions(refs: readonly GuestVoiceMentionRef[]) {
  return sql.join(
    refs.map(
      (ref) =>
        sql`(${ref.reviewId}::uuid, ${ref.sourceRevision}::bigint, ${ref.analysisSequence}::bigint, ${ref.mentionOrdinal}::smallint)`,
    ),
    sql`, `,
  )
}

export function createAiGuestVoiceFactsAdapter(db: Database): AiGuestVoiceFactsPort {
  return {
    hasV3Analyses: (scope) =>
      withStatementTimeout(db, AI_INSIGHTS_READ_BUDGET_MS, (tx) => readHasV3(tx, scope)),

    readFacts: (scope, period) =>
      withStatementTimeout(db, AI_INSIGHTS_READ_BUDGET_MS, async (tx) => {
        const locked = await readLockedAggregateHead(tx, scope)
        if (locked === null) return null
        const rows = await readFactsRows(tx, scope, period)
        const { reviews, unavailable } = splitRows(rows, scope.sourceEpoch)
        return {
          coverage: locked.coverage,
          reviews,
          unavailable,
          groups: await readIssueGroups(tx, scope),
        }
      }),

    readMentionSentences: async (scope, refs) => {
      const sentences = new Map<string, readonly number[]>()
      if (refs.length === 0) return sentences
      return withStatementTimeout(db, AI_INSIGHTS_READ_BUDGET_MS, async (tx) => {
        const result = await tx.execute<{
          reviewId: string
          mentionOrdinal: number
          sentences: number[]
        }>(sql`
          SELECT
            sentence.review_id::text AS "reviewId",
            sentence.mention_ordinal AS "mentionOrdinal",
            array_agg(sentence.sentence_number ORDER BY sentence.sentence_number) AS sentences
          FROM ai_review_analysis_mention_sentences AS sentence
          INNER JOIN (VALUES ${wantedMentions(refs)})
            AS wanted(review_id, source_revision, analysis_sequence, mention_ordinal)
            ON sentence.review_id = wanted.review_id
           AND sentence.source_revision = wanted.source_revision
           AND sentence.analysis_sequence = wanted.analysis_sequence
           AND sentence.mention_ordinal = wanted.mention_ordinal
          WHERE sentence.organization_id = ${scope.organizationId}
            AND sentence.property_id = ${scope.propertyId}::uuid
            AND sentence.source_epoch = ${scope.sourceEpoch}
          GROUP BY sentence.review_id, sentence.mention_ordinal
        `)
        for (const row of result.rows) {
          sentences.set(mentionRefKey(row), row.sentences)
        }
        return sentences
      })
    },
  }
}
