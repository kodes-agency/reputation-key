// Inbox context — stopping a measured Google Review Response Target.
//
// The target stops once, when a reply Google shows closes the Handling Cycle.
// Only `completion_at` (and what is derived from it) carries Google's reply
// time. `updated_at` and the reminder cancellations stay at the instant RepKey
// processed the close: the row triggers refuse an `updated_at` that moves back,
// and a reply may well predate the row RepKey created for it.

import { and, eq, isNull } from 'drizzle-orm'
import {
  inboxHandlingCycleResponseTargets,
  inboxResponseTargetReminders,
} from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { HandlingCycleHead } from '../domain/types'
import {
  classifyResponseTargetCompletion,
  resolveGoogleReplyCompletion,
} from '../domain/response-target'
import { inboxError } from '../domain/errors'

export type GoogleReviewTargetCompletion = Readonly<{
  result: 'on_time' | 'late' | 'not_measured'
  completedAt: Date
}>

/**
 * Stop a measured Review target only after exact current Google truth is live.
 * `observedAt` is when RepKey read the reply; `repliedAt` is Google's own time
 * for it (its last edit), null when Google gave none. The target completes at
 * the reply's time, kept between the target's start and the read. Returns the
 * outcome and the moment the reply counts as given, which is also when the
 * item's first reply is stamped; with no measured target that moment has no
 * lower bound.
 */
export async function completeGoogleReviewTarget(
  tx: Tx,
  current: HandlingCycleHead,
  observedAt: Date,
  repliedAt: Date | null = null,
): Promise<GoogleReviewTargetCompletion> {
  if (current.sourceType !== 'review') {
    throw inboxError('invalid_input', 'Google Review Response Target requires review')
  }
  // The Private Feedback stop in response-target.store.ts reads its row the same way.
  // fallow-ignore-next-line code-duplication
  const [target] = await tx
    .select()
    .from(inboxHandlingCycleResponseTargets)
    .where(
      and(
        eq(inboxHandlingCycleResponseTargets.inboxItemId, current.inboxItemId),
        eq(inboxHandlingCycleResponseTargets.cycleNumber, current.currentCycleNumber),
        eq(inboxHandlingCycleResponseTargets.organizationId, current.organizationId),
        eq(inboxHandlingCycleResponseTargets.targetKind, 'google_review_response'),
      ),
    )
    .for('update')
    .limit(1)
  if (!target || target.performanceEligibility !== 'measured') {
    return {
      result: 'not_measured',
      completedAt: resolveGoogleReplyCompletion({ repliedAt, startAt: null, observedAt }),
    }
  }
  if (target.completionAt !== null || target.dueAt === null) {
    throw inboxError('revision_conflict', 'Google Review Response Target already stopped')
  }
  if (target.startAt === null) {
    throw inboxError('revision_conflict', 'Google Review Response Target has no start')
  }
  const completedAt = resolveGoogleReplyCompletion({
    repliedAt,
    startAt: target.startAt,
    observedAt,
  })
  const result = classifyResponseTargetCompletion(target.dueAt, completedAt)
  const [saved] = await tx
    .update(inboxHandlingCycleResponseTargets)
    .set({
      completionAt: completedAt,
      result,
      stopReason: 'confirmed_on_google',
      updatedAt: observedAt,
    })
    .where(
      and(
        eq(inboxHandlingCycleResponseTargets.inboxItemId, current.inboxItemId),
        eq(inboxHandlingCycleResponseTargets.cycleNumber, current.currentCycleNumber),
        eq(inboxHandlingCycleResponseTargets.organizationId, current.organizationId),
        isNull(inboxHandlingCycleResponseTargets.completionAt),
      ),
    )
    .returning({ inboxItemId: inboxHandlingCycleResponseTargets.inboxItemId })
  if (!saved) {
    throw inboxError('revision_conflict', 'Google Review Response Target changed')
  }
  await tx
    .update(inboxResponseTargetReminders)
    .set({ cancelledAt: observedAt, updatedAt: observedAt })
    .where(
      and(
        eq(inboxResponseTargetReminders.inboxItemId, current.inboxItemId),
        eq(inboxResponseTargetReminders.cycleNumber, current.currentCycleNumber),
        eq(inboxResponseTargetReminders.organizationId, current.organizationId),
        isNull(inboxResponseTargetReminders.deliveredAt),
        isNull(inboxResponseTargetReminders.cancelledAt),
      ),
    )
  return { result, completedAt }
}
