import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { DraftGenerationMeasurement } from '#/shared/domain/draft-measurement'

/** Only separately admitted operations count as attempts; the rewrite shares its root. */
export async function recordDraftGeneration(
  db: Database,
  input: DraftGenerationMeasurement,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    // Advisory telemetry must not wait behind erasure or Property row locks.
    await tx.execute(sql`SET LOCAL lock_timeout = '50ms'`)
    await tx.execute(sql`SET LOCAL statement_timeout = '250ms'`)
    const lock = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('ai-draft-measurement'), hashtext(${input.organizationId})) AS acquired`,
    )
    if (!lock.rows[0]?.acquired) return null
    const result = await tx.execute(sql`
    INSERT INTO ai_draft_measurements (
      operation_id, organization_id, property_id, review_id, actor_user_id, request_key,
      contract, intent, trigger, tone, language, rating_band, "case", provider_attempts,
      outcome, refusal_code, latency_ms, base_reply_revision, created_at, draft_pressed, try_again_pressed, shorter_pressed, tone_pressed
    )
    SELECT root.id, root.organization_id, root.property_id, root.review_id,
      root.actor_user_id, root.idempotency_key, ${input.contract}, ${input.intent},
      ${input.trigger}, root.tone, root.concrete_reply_language_tag,
      CASE WHEN review.rating <= 2 THEN 'low' WHEN review.rating = 3 THEN 'middle' ELSE 'high' END,
      ${input.case}, 1 + (SELECT count(*)::int FROM ai_operations child
        WHERE child.rewrite_parent_operation_id = root.id AND child.execution_attempt > 0),
      ${input.outcome}, CASE WHEN ${input.outcome} = 'ready' THEN NULL ELSE coalesce((SELECT child.failure_code FROM ai_operations child
        WHERE child.rewrite_parent_operation_id = root.id), root.failure_code, ${input.refusalCode}) END,
      ${input.latencyMs}, root.base_reply_state_revision, root.created_at,
      ${input.intent === 'explicit' && input.trigger === 'draft'}, ${input.intent === 'explicit' && input.trigger === 'try_again'}, ${input.intent === 'explicit' && input.trigger === 'shorter'}, ${input.intent === 'explicit' && input.trigger === 'tone'}
    FROM ai_operations root
    JOIN reviews review ON review.id = root.review_id AND review.organization_id = root.organization_id
    JOIN ai_property_processing_profiles profile ON profile.organization_id = root.organization_id AND profile.property_id = root.property_id
    JOIN properties property ON property.organization_id = root.organization_id AND property.id = root.property_id
    JOIN ai_execution_control_heads global_control ON global_control.control_id = root.global_control_id
    JOIN ai_execution_control_heads provider_control ON provider_control.control_id = root.provider_control_id
    JOIN ai_execution_control_heads capability_control ON capability_control.control_id = root.capability_control_id
    JOIN merchant_ai_enablement merchant ON merchant.property_id = root.property_id
      AND merchant.organization_id = root.organization_id
    WHERE root.organization_id = ${input.organizationId} AND root.property_id = ${input.propertyId}::uuid
      AND root.review_id = ${input.reviewId}::uuid AND root.actor_user_id = ${input.actorUserId}
      AND root.idempotency_key = ${input.requestKey} AND root.command = 'reply'
      AND root.rewrite_parent_operation_id IS NULL AND root.execution_attempt > 0
      AND profile.profile_version = root.property_profile_version AND profile.lifecycle_state = 'active'
      AND property.lifecycle_state = 'active' AND review.source_content_state = 'active'
      AND review.source_epoch = root.source_epoch AND review.source_revision = root.source_revision
      AND global_control.generation = root.global_control_generation AND global_control.execution_state = 'enabled'
      AND provider_control.generation = root.provider_control_generation AND provider_control.execution_state = 'enabled'
      AND capability_control.generation = root.capability_control_generation AND capability_control.execution_state = 'enabled'
      AND NOT EXISTS (SELECT 1 FROM organization_lifecycle_authority lifecycle WHERE lifecycle.organization_id = root.organization_id AND lifecycle.state <> 'active')
      AND merchant.state = 'enabled'  AND merchant.capabilities @> ARRAY['reply_drafting']::text[]
      AND root.authorization_lineage_id = merchant.authorization_lineage_id
      AND root.capability_fences->>'replyDraftingEpoch' = merchant.reply_drafting_epoch::text
    ON CONFLICT (organization_id, actor_user_id, request_key) DO UPDATE
      SET outcome = CASE WHEN ai_draft_measurements.outcome = 'ready' THEN 'ready' ELSE excluded.outcome END,
          provider_attempts = greatest(ai_draft_measurements.provider_attempts, excluded.provider_attempts),
          refusal_code = CASE WHEN ai_draft_measurements.outcome = 'ready' THEN ai_draft_measurements.refusal_code ELSE excluded.refusal_code END,
          "case" = CASE WHEN ai_draft_measurements.outcome = 'ready' THEN ai_draft_measurements."case" ELSE excluded."case" END,
          latency_ms = CASE WHEN ai_draft_measurements.outcome = 'ready' THEN ai_draft_measurements.latency_ms ELSE excluded.latency_ms END
    RETURNING id
  `)
    return (result.rows[0] as { id: string } | undefined)?.id ?? null
  })
}
