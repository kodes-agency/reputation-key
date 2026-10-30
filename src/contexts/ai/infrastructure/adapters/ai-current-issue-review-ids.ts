// Which reviews currently carry a mention of one Property issue: the governed read
// behind the Inbox's "filter by issue". It is the aspect filter's shape over the v3
// analysis: the reviews whose current analysis (same policy as every attribute filter,
// `findCurrentAnalysisReviewIds`) holds an effective mention of the issue, where
// effective is the answer with a manager's corrections laid over it. A removed topic's
// mentions are not there, a complaint marked "not a problem" counts as neutral, a changed
// cause counts under the issue it moved to, and a merged issue is its survivor.
import { gt, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { ReviewId } from '#/shared/domain/ids'
import { aiReviewAnalyses } from '#/shared/db/schema'
import { findCurrentAnalysisReviewIds } from './ai-current-analysis-review-ids'

export type CurrentIssueReviewIdsInput = Readonly<{
  organizationId: string
  propertyIds?: readonly string[]
  issueId: string
  /** Which way the review feels about the issue; absent means any. */
  polarities?: readonly ('positive' | 'neutral' | 'negative')[]
  nowEpochMillis: number
}>

function polarityCondition(polarities: CurrentIssueReviewIdsInput['polarities']) {
  if (polarities === undefined || polarities.length === 0) return sql`TRUE`
  return sql`(CASE WHEN correction.kind = 'not_a_problem' THEN 'neutral' ELSE mention.polarity END) IN (${sql.join(
    polarities.map((polarity) => sql`${polarity}`),
    sql`, `,
  )})`
}

export function findCurrentReviewIdsByIssue(
  db: Database,
  input: CurrentIssueReviewIdsInput,
): Promise<readonly ReviewId[]> {
  if (input.polarities?.length === 0) return Promise.resolve([])
  return findCurrentAnalysisReviewIds(db, input, (now) => [
    sql`EXISTS (
      SELECT 1
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
      WHERE mention.organization_id = ${aiReviewAnalyses.organizationId}
        AND mention.property_id = ${aiReviewAnalyses.propertyId}
        AND mention.review_id = ${aiReviewAnalyses.reviewId}
        AND mention.source_epoch = ${aiReviewAnalyses.sourceEpoch}
        AND mention.source_revision = ${aiReviewAnalyses.sourceRevision}
        AND mention.analysis_sequence = ${aiReviewAnalyses.analysisSequence}
        AND correction.kind IS DISTINCT FROM 'remove_topic'
        AND (CASE WHEN correction.kind = 'change_cause'
              THEN COALESCE(replacement_group.merged_into_issue_id, correction.replacement_issue_group_id)
              ELSE COALESCE(issue_group.merged_into_issue_id, mention.issue_group_id) END)
          = (SELECT COALESCE(target.merged_into_issue_id, target.id)
             FROM ai_property_issue_groups AS target
             WHERE target.organization_id = ${input.organizationId}
               AND target.id = ${input.issueId}::uuid)
        AND ${polarityCondition(input.polarities)}
    )`,
    gt(aiReviewAnalyses.expiresAt, now),
  ])
}
