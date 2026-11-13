// Digest batches left open by a first sweep, for the retry suites: the sweep
// runs for real against a provider that fails, so the batch, its members and
// their attempt records are what the job itself wrote.

import { and, eq } from 'drizzle-orm'
import { notificationDigestBatches, notificationUserSettings } from '#/shared/db/schema'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'
import { ORG, USER, type DigestWorld } from './digest-job-test-deps'

const transientFailure = (
  refusedBeforeAcceptance = false,
): NotificationDeliveryOutcome => ({
  kind: 'rejected',
  classification: 'transient',
  providerCode: null,
  ...(refusedBeforeAcceptance ? { refusedBeforeAcceptance: true } : {}),
})

/**
 * Runs the first sweep against a provider that fails transiently and returns
 * the batch it left open, with the request it froze.
 */
export async function freezeBatchAtFirstSweep(
  world: DigestWorld,
  options: Readonly<{ refused?: boolean }> = {},
) {
  const first = world.deps()
  first.emailSender.send.mockResolvedValue(transientFailure(options.refused === true))
  await world.run(first)
  const [batch] = await world.batches()
  if (!batch) throw new Error('The first sweep froze no batch')
  return { batch, firstRequest: first.emailSender.send.mock.calls[0]![0] }
}

/** The state a worker lost between the provider call and its answer leaves. */
export async function loseWorkerMidCall(world: DigestWorld, batchId: string) {
  await world.db
    .update(notificationDigestBatches)
    .set({
      state: 'prepared',
      retryCount: 0,
      outcomeClass: 'in_flight',
      failedAt: null,
    })
    .where(eq(notificationDigestBatches.id, batchId))
  for (const entry of world.entries) {
    await world.setEmail(entry, {
      status: 'pending',
      retryCount: 0,
      lastErrorClass: null,
      failedAt: null,
      nextAttemptAt: null,
    })
  }
}

/** The state of a batch no attempt was ever started for. */
export async function neverStarted(world: DigestWorld, batchId: string) {
  await loseWorkerMidCall(world, batchId)
  await world.db
    .update(notificationDigestBatches)
    .set({ outcomeClass: null, attemptedAt: null })
    .where(eq(notificationDigestBatches.id, batchId))
}

export const setQuietHours = (world: DigestWorld, start: string, end: string) =>
  world.db
    .update(notificationUserSettings)
    .set({ quietHoursStart: start, quietHoursEnd: end })
    .where(
      and(
        eq(notificationUserSettings.userId, USER),
        eq(notificationUserSettings.organizationId, ORG),
      ),
    )
