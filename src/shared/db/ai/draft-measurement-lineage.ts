import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import type { DraftEditMetric } from '#/shared/domain/draft-measurement'

type Revision = Readonly<{ id: string; stateRevision: number }>

export async function adoptDraftMeasurement(
  tx: Tx,
  operationId: string,
  reply: Revision,
): Promise<void> {
  await tx.execute(sql`
    WITH adopted AS (
      UPDATE ai_draft_measurements m SET adopted_at = coalesce(adopted_at, transaction_timestamp()),
        superseded_at = NULL, adopted_reply_id = ${reply.id}::uuid, adopted_revision = coalesce(adopted_revision, ${reply.stateRevision})
      WHERE m.operation_id = coalesce((SELECT rewrite_parent_operation_id FROM ai_operations WHERE id = ${operationId}::uuid), ${operationId}::uuid)
        AND m.outcome = 'ready'
      RETURNING id
    ) INSERT INTO ai_draft_measurement_links (reply_id, reply_revision, generation_id)
      SELECT ${reply.id}::uuid, ${reply.stateRevision}, (SELECT id FROM adopted)
      WHERE (SELECT generation_id FROM ai_draft_measurement_links
        WHERE reply_id = ${reply.id}::uuid AND reply_revision <= ${reply.stateRevision}
        ORDER BY reply_revision DESC LIMIT 1) IS DISTINCT FROM (SELECT id FROM adopted)
      ON CONFLICT (reply_id, reply_revision) DO UPDATE SET generation_id = excluded.generation_id
  `)
}

/** A restore may select only a generation already adopted into this very reply. */
export async function carryDraftMeasurement(
  tx: Tx,
  before: Revision,
  after: Revision,
  restore?: string | null,
): Promise<void> {
  if (restore === undefined) return
  await tx.execute(sql`
    WITH prior AS (
      SELECT generation_id FROM ai_draft_measurement_links
      WHERE reply_id = ${before.id}::uuid AND reply_revision <= ${before.stateRevision}
      ORDER BY reply_revision DESC LIMIT 1
    ), restored AS (
      SELECT id FROM ai_draft_measurements
      WHERE id = ${restore}::uuid AND adopted_reply_id = ${after.id}::uuid
    )
    INSERT INTO ai_draft_measurement_links (reply_id, reply_revision, generation_id)
    SELECT ${after.id}::uuid, ${after.stateRevision}, (SELECT id FROM restored)
    WHERE (SELECT generation_id FROM prior) IS DISTINCT FROM (SELECT id FROM restored)
    ON CONFLICT (reply_id, reply_revision) DO UPDATE SET generation_id = excluded.generation_id
  `)
}

export async function submitDraftMeasurement(
  tx: Tx,
  before: Revision,
  submitted: Revision,
  metric?: DraftEditMetric,
): Promise<void> {
  // Untrusted numbers are never used unless the complete browser revision matches.
  const valid =
    metric?.replyId === before.id &&
    metric.replyRevision === before.stateRevision &&
    typeof metric.distance === 'number' &&
    Number.isFinite(metric.distance) &&
    metric.distance >= 0 &&
    metric.distance <= 1
  await tx.execute(sql`
    UPDATE ai_draft_measurements m
    SET submitted_at = coalesce(submitted_at, transaction_timestamp()),
      submitted_revision = CASE WHEN submitted_at IS NULL THEN ${submitted.stateRevision} ELSE submitted_revision END,
      edit_distance = CASE WHEN submitted_at IS NULL AND m.id = ${valid ? metric?.generationId : null}::uuid THEN ${valid ? metric?.distance : null}::double precision ELSE edit_distance END,
      edited_before_submit = CASE WHEN submitted_at IS NULL AND m.id = ${valid ? metric?.generationId : null}::uuid THEN ${valid ? metric!.distance! > 0 : null}::boolean ELSE edited_before_submit END
    WHERE m.id = (SELECT l.generation_id FROM ai_draft_measurement_links l
      WHERE l.reply_id = ${before.id}::uuid AND l.reply_revision <= ${submitted.stateRevision}
      ORDER BY l.reply_revision DESC LIMIT 1)
  `)
}

/** Called only after the Google observation has confirmed the publication attempt. */
export async function publishDraftMeasurement(tx: Tx, reply: Revision): Promise<void> {
  await tx.execute(sql`
    UPDATE ai_draft_measurements m SET published_at = coalesce(published_at, transaction_timestamp())
    WHERE m.id = (SELECT l.generation_id FROM ai_draft_measurement_links l
      WHERE l.reply_id = ${reply.id}::uuid AND l.reply_revision <= ${reply.stateRevision}
      ORDER BY l.reply_revision DESC LIMIT 1) AND m.submitted_at IS NOT NULL
  `)
}

/** A browser Undo can change measurement for identical text without forcing a save. */
export function submittedMeasurementIdentity(
  before: Revision,
  metric?: DraftEditMetric,
): string | null | undefined {
  return metric?.replyId === before.id && metric.replyRevision === before.stateRevision
    ? metric.generationId
    : undefined
}
