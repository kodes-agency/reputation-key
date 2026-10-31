import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { AiAuthorizationLifecycleTrigger } from '../../application/ports/ai-review-analysis-enrollment.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/** The caller holds the Property and current grant. A consent change outside
 * Review Analysis's epoch carries its enrollment/progress forward, retaining an
 * exact state-version fence without replaying history or renewing approval. */
export async function preserveAnalysisEnrollment(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
): Promise<string | null> {
  const result = await tx.execute<{ id: string }>(sql`
    UPDATE ai_review_analysis_enrollments AS enrollment
    SET authorization_state_version = ${input.fence.authorizationStateVersion},
        updated_at = GREATEST(enrollment.updated_at, ${input.occurredAt})
    WHERE enrollment.id = (
      SELECT id FROM ai_review_analysis_enrollments
      WHERE organization_id = ${input.organizationId}
        AND property_id = ${input.propertyId}::uuid
        AND authorization_lineage_id = ${input.fence.authorizationLineageId}::uuid
        AND authorization_state_version <= ${input.fence.authorizationStateVersion}
        AND source_epoch = ${input.fence.sourceEpoch}
        AND review_analysis_epoch = ${input.fence.reviewAnalysisEpoch}
        AND analysis_start_sequence = ${input.fence.analysisStartSequence}
        AND state <> 'superseded'
      ORDER BY authorization_state_version DESC
      LIMIT 1 FOR UPDATE
    ) RETURNING enrollment.id
  `)
  return result.rows[0]?.id ?? null
}
