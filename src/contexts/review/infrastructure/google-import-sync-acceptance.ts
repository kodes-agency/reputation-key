import { reviewProviderSnapshotRuns } from '#/shared/db/schema/review.schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { startOrResumeSnapshot } from './repositories/review-provider-snapshot.repository'
import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
import {
  eventConsumerReceipts,
  outboxEvents,
  idempotencyReceipts,
} from '#/shared/db/schema/outbox.schema'
import type { SyncPropertyReviewsJobData } from '../application/ports/review-queue.port'

/** Called after the worker commits progress or records the terminal retry schedule. The
 * binding event remains owed across queue loss before this point. */
export async function acceptGoogleImportSync(
  db: Database,
  data: SyncPropertyReviewsJobData,
): Promise<void> {
  if (!data.importBindingEventId) return
  await db.transaction(async (tx) => {
    const bindingPayload = await requireImportBindingEvent(tx, data, 'acceptance')
    if (bindingPayload.change !== 'created' && bindingPayload.change !== 'relinked')
      throw new Error('Import sync acceptance attribution mismatch')
    if (!data.runId) throw new Error('Import sync acceptance lacks a durable run')
    const [run] = await tx
      .select({ state: reviewProviderSnapshotRuns.state })
      .from(reviewProviderSnapshotRuns)
      .where(
        and(
          eq(reviewProviderSnapshotRuns.organizationId, data.organizationId),
          eq(reviewProviderSnapshotRuns.propertyId, data.propertyId),
          eq(reviewProviderSnapshotRuns.sourceEpoch, data.sourceEpoch!),
          eq(reviewProviderSnapshotRuns.id, data.runId),
        ),
      )
      .limit(1)
    if (!run) throw new Error('Import sync acceptance lacks durable progress')
    await tx
      .insert(eventConsumerReceipts)
      .values({
        eventId: data.importBindingEventId!,
        consumerName: 'integration.import-review-sync',
        status: 'applied',
      })
      .onConflictDoNothing()
    await tx
      .delete(idempotencyReceipts)
      .where(
        and(
          eq(idempotencyReceipts.scope, 'review_import_sync'),
          eq(idempotencyReceipts.key, data.importBindingEventId!),
        ),
      )
  })
}

/** Keep one initial run identity behind the binding fact until a worker accepts
 * it. A committed run alone cannot prove Redis still holds its first job. */
export async function admitGoogleImportSync(
  db: Database,
  idGen: () => string,
  data: SyncPropertyReviewsJobData,
): Promise<SyncPropertyReviewsJobData | null> {
  if (!data.importBindingEventId) return data
  return db.transaction(async (tx) => {
    await requireImportBindingEvent(tx, data, 'admission')
    const [accepted] = await tx
      .select({ eventId: eventConsumerReceipts.eventId })
      .from(eventConsumerReceipts)
      .where(
        and(
          eq(eventConsumerReceipts.eventId, data.importBindingEventId!),
          eq(eventConsumerReceipts.consumerName, 'integration.import-review-sync'),
        ),
      )
      .limit(1)
    if (accepted) return null
    const [prior] = await tx
      .select({ payload: idempotencyReceipts.payload })
      .from(idempotencyReceipts)
      .where(
        and(
          eq(idempotencyReceipts.scope, 'review_import_sync'),
          eq(idempotencyReceipts.key, data.importBindingEventId!),
        ),
      )
      .limit(1)
    if (prior) {
      if (typeof prior.payload.runId !== 'string')
        throw new Error('Import sync admission is invalid')
      const [run] = await tx
        .select({ state: reviewProviderSnapshotRuns.state })
        .from(reviewProviderSnapshotRuns)
        .where(
          and(
            eq(reviewProviderSnapshotRuns.organizationId, data.organizationId),
            eq(reviewProviderSnapshotRuns.id, prior.payload.runId),
          ),
        )
        .limit(1)
      // Replaying the same failed run lets Review recover a missing failure
      // record or preserve its existing retry deadline, without another Google read.
      if (run) return { ...data, runId: prior.payload.runId }
    }
    const run = await startOrResumeSnapshot(tx, idGen, {
      organizationId: organizationId(data.organizationId),
      propertyId: propertyId(data.propertyId),
      sourceEpoch: data.sourceEpoch!,
      observationOrigin: 'historical_onboarding',
    })
    const payload = {
      organizationId: data.organizationId,
      propertyId: data.propertyId,
      sourceEpoch: data.sourceEpoch,
      runId: run.id,
    }
    await tx
      .insert(idempotencyReceipts)
      .values({
        scope: 'review_import_sync',
        key: data.importBindingEventId!,
        payload,
      })
      .onConflictDoUpdate({
        target: [idempotencyReceipts.scope, idempotencyReceipts.key],
        set: {
          payload,
        },
      })
    return { ...data, runId: run.id }
  })
}

async function requireImportBindingEvent(
  tx: Tx,
  data: SyncPropertyReviewsJobData,
  phase: 'admission' | 'acceptance',
) {
  const [event] = await tx
    .select({ payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.id, data.importBindingEventId!),
        eq(outboxEvents.eventType, 'property.google_binding.changed'),
        eq(outboxEvents.organizationId, data.organizationId),
        eq(outboxEvents.propertyId, data.propertyId),
      ),
    )
    .for('update')
    .limit(1)
  const payload = event?.payload as Record<string, unknown> | undefined
  if (
    !payload ||
    payload.importFollowUps !== true ||
    payload.sourceEpoch !== data.sourceEpoch ||
    payload.connectionId !== data.connectionId
  )
    throw new Error(`Import sync ${phase} attribution mismatch`)
  return payload
}
