import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { excludedFromResponseTargetReporting } from '#/shared/db/inbox-response-target-exclusions'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleResponseTargets,
  inboxPrivateFeedbackTargetPropertyOverrides,
  inboxResponseTargetOrganizationPolicies,
  inboxResponseTargetReminders,
} from '#/shared/db/schema/inbox.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { inboxItemId, organizationId, propertyId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type {
  ResponseTargetStore,
  ResponseTargetView,
} from '../application/ports/response-target.store'
import type { HandlingCycle, HandlingCycleHead } from '../domain/types'
import type { ReviewCycleTargetAnchor } from '../application/ports/review-response-target-authority.port'
import {
  buildResponseTargetSnapshot,
  classifyResponseTargetCompletion,
  evaluateResponseTarget,
  resolveGoogleReviewTargetPolicy,
  resolvePrivateFeedbackTargetPolicy,
  schedulableReminders,
  type ResponseTargetResult,
  type ResponseTargetSnapshot,
} from '../domain/response-target'
import { inboxError } from '../domain/errors'
import { createResponseTargetAnalyticsStore } from './response-target-analytics.store'
import { createReminderReleaseStore } from './response-target-reminder-release.store'

type TargetRow = typeof inboxHandlingCycleResponseTargets.$inferSelect

type ReviewAuthority = NonNullable<ReviewCycleTargetAnchor['reviewAuthority']>

/** The permit must be one Review issues, for exactly this Review at this revision. */
function assertReviewAuthorityMatchesCycle(
  cycle: HandlingCycle,
  reviewAuthority: ReviewAuthority,
): void {
  if (
    reviewAuthority.authority !== 'review.current-response-target.v1' &&
    reviewAuthority.authority !== 'review.inbox-projection-revision.v1'
  ) {
    throw inboxError('invalid_input', 'Review Response Target authority is invalid')
  }
  if (
    reviewAuthority.organizationId !== cycle.organizationId ||
    reviewAuthority.propertyId !== cycle.propertyId ||
    reviewAuthority.reviewId !== cycle.sourceId ||
    reviewAuthority.materialReviewRevision !== cycle.sourceRevision
  ) {
    throw inboxError(
      'invalid_input',
      'Review Response Target authority does not match the Handling Cycle',
    )
  }
  if (
    reviewAuthority.authority === 'review.inbox-projection-revision.v1' &&
    cycle.openedReason !== 'review_observed' &&
    cycle.openedReason !== 'material_revision_changed'
  ) {
    throw inboxError(
      'invalid_input',
      'Historical Review authority is limited to source-event projection cycles',
    )
  }
}

/**
 * An operational clock is only admissible on a live operational reopen, and it
 * must be the very instant the cycle opened.
 */
function assertOperationalTargetStart(
  cycle: HandlingCycle,
  targetAnchor: ReviewCycleTargetAnchor | undefined,
): void {
  if (targetAnchor?.targetStart.basis !== 'operational_reopen') return
  if (targetAnchor.reviewAuthority?.authority !== 'review.current-response-target.v1') {
    throw inboxError(
      'invalid_input',
      'Operational target timing requires current Review authority',
    )
  }
  if (
    cycle.openedReason !== 'manual_reopen' &&
    cycle.openedReason !== 'provider_reply_deleted'
  ) {
    throw inboxError(
      'invalid_input',
      'Operational target timing requires an operational Review reopen',
    )
  }
  if (
    !Number.isFinite(targetAnchor.targetStart.at.getTime()) ||
    targetAnchor.targetStart.at.getTime() !== cycle.openedAt.getTime()
  ) {
    throw inboxError(
      'invalid_input',
      'Operational target timing must start with its Handling Cycle',
    )
  }
}

/** Validate a Review-owned permit before any Inbox cycle row is written. */
export function assertReviewResponseTargetAuthorityMatchesCycle(
  cycle: HandlingCycle,
  targetAnchor?: ReviewCycleTargetAnchor,
): void {
  const reviewAuthority = targetAnchor?.reviewAuthority
  if (cycle.sourceType !== 'review') {
    if (targetAnchor !== undefined) {
      throw inboxError(
        'invalid_input',
        'Review Response Target authority cannot open a Feedback Handling Cycle',
      )
    }
    return
  }
  if (reviewAuthority !== undefined) {
    assertReviewAuthorityMatchesCycle(cycle, reviewAuthority)
  }
  const eligibility = reviewAuthority?.eligibility ?? 'legacy_unknown'
  const startAt = reviewAuthority?.responseTargetStartAt ?? null
  if ((eligibility === 'measured') !== startAt instanceof Date) {
    throw inboxError('invalid_input', 'Review Response Target provenance is invalid')
  }
  assertOperationalTargetStart(cycle, targetAnchor)
}

type ReviewCycleTargetProvenance = Readonly<{
  eligibility: 'measured' | 'historical_onboarding' | 'legacy_unknown'
  startAt: Date | null
}>

/** Resolve target timing without mutating Review's attested source permit. */
export function resolveReviewCycleTargetProvenance(
  cycle: HandlingCycle,
  targetAnchor?: ReviewCycleTargetAnchor,
): ReviewCycleTargetProvenance {
  assertReviewResponseTargetAuthorityMatchesCycle(cycle, targetAnchor)
  if (!targetAnchor) return { eligibility: 'legacy_unknown', startAt: null }
  if (targetAnchor.targetStart.basis === 'operational_reopen') {
    return { eligibility: 'measured', startAt: targetAnchor.targetStart.at }
  }
  return {
    eligibility: targetAnchor.reviewAuthority.eligibility,
    startAt: targetAnchor.reviewAuthority.responseTargetStartAt,
  }
}

/**
 * Record the snapshot's reminder slots, leaving out a halfway slot already
 * due when the target is created. The schedule trigger only accepts a slot
 * equal to the snapshot, so that slot is left out rather than moved later.
 */
async function insertSchedulableReminders(
  tx: Tx,
  cycle: HandlingCycle,
  snapshot: ResponseTargetSnapshot,
  createdAt: Date,
): Promise<void> {
  const reminders = schedulableReminders(snapshot, createdAt)
  if (reminders.length === 0) return
  await tx.insert(inboxResponseTargetReminders).values(
    reminders.map((reminder) => ({
      inboxItemId: cycle.inboxItemId,
      cycleNumber: cycle.cycleNumber,
      organizationId: cycle.organizationId,
      propertyId: cycle.propertyId,
      targetKind: snapshot.targetKind,
      reminderKind: reminder.kind,
      scheduledFor: reminder.scheduledFor,
      createdAt,
      updatedAt: createdAt,
    })),
  )
}

/**
 * Land one measured snapshot beside its Handling Cycle and schedule the
 * reminders it still has time for. Google Reviews and private feedback differ
 * only in how the snapshot was resolved: the row they write, and the fact that
 * the reminders follow it in the same transaction, are one decision.
 */
async function insertMeasuredTarget(
  tx: Tx,
  cycle: HandlingCycle,
  snapshot: ResponseTargetSnapshot,
  createdAt: Date,
): Promise<void> {
  await tx.insert(inboxHandlingCycleResponseTargets).values({
    inboxItemId: cycle.inboxItemId,
    cycleNumber: cycle.cycleNumber,
    organizationId: cycle.organizationId,
    propertyId: cycle.propertyId,
    sourceType: cycle.sourceType,
    sourceId: cycle.sourceId,
    sourceRevision: cycle.sourceRevision,
    targetKind: snapshot.targetKind,
    performanceEligibility: snapshot.eligibility,
    durationMinutes: snapshot.durationMinutes,
    policySource: snapshot.policySource,
    policyVersion: snapshot.policyVersion,
    startAt: snapshot.startAt,
    dueAt: snapshot.dueAt,
    createdAt,
    updatedAt: createdAt,
  })
  await insertSchedulableReminders(tx, cycle, snapshot, createdAt)
}

/** Insert the immutable source-specific target beside its Handling Cycle. */
export async function insertResponseTargetForHandlingCycle(
  tx: Tx,
  cycle: HandlingCycle,
  createdAt: Date,
  targetAnchor?: ReviewCycleTargetAnchor,
): Promise<void> {
  assertReviewResponseTargetAuthorityMatchesCycle(cycle, targetAnchor)
  if (cycle.sourceType === 'review') {
    const { eligibility, startAt } = resolveReviewCycleTargetProvenance(
      cycle,
      targetAnchor,
    )
    if (eligibility !== 'measured') {
      await tx.insert(inboxHandlingCycleResponseTargets).values({
        inboxItemId: cycle.inboxItemId,
        cycleNumber: cycle.cycleNumber,
        organizationId: cycle.organizationId,
        propertyId: cycle.propertyId,
        sourceType: cycle.sourceType,
        sourceId: cycle.sourceId,
        sourceRevision: cycle.sourceRevision,
        targetKind: 'google_review_response',
        performanceEligibility: eligibility,
        createdAt,
        updatedAt: createdAt,
      })
      return
    }
    if (!(startAt instanceof Date)) {
      throw inboxError('invalid_input', 'Measured Review Response Target has no start')
    }
    const [organizationPolicy] = await tx
      .select({
        durationMinutes: inboxResponseTargetOrganizationPolicies.durationMinutes,
        policyVersion: inboxResponseTargetOrganizationPolicies.policyVersion,
        lowRatingThreshold: inboxResponseTargetOrganizationPolicies.lowRatingThreshold,
        lowRatingDurationMinutes:
          inboxResponseTargetOrganizationPolicies.lowRatingDurationMinutes,
      })
      .from(inboxResponseTargetOrganizationPolicies)
      .where(
        and(
          eq(
            inboxResponseTargetOrganizationPolicies.organizationId,
            cycle.organizationId,
          ),
          eq(
            inboxResponseTargetOrganizationPolicies.targetKind,
            'google_review_response',
          ),
        ),
      )
      .limit(1)
    const snapshot = buildResponseTargetSnapshot({
      targetKind: 'google_review_response',
      // The rating comes from Review's attested permit, the same fenced read
      // that supplies the target's start instant, so the clock is chosen from
      // the revision this cycle actually measures.
      policy: resolveGoogleReviewTargetPolicy(
        organizationPolicy ?? null,
        targetAnchor?.reviewAuthority.rating ?? null,
      ),
      startAt,
    })
    await insertMeasuredTarget(tx, cycle, snapshot, createdAt)
    return
  }

  const [propertyPolicy] = await tx
    .select({
      durationMinutes: inboxPrivateFeedbackTargetPropertyOverrides.durationMinutes,
      policyVersion: inboxPrivateFeedbackTargetPropertyOverrides.policyVersion,
    })
    .from(inboxPrivateFeedbackTargetPropertyOverrides)
    .where(
      and(
        eq(
          inboxPrivateFeedbackTargetPropertyOverrides.organizationId,
          cycle.organizationId,
        ),
        eq(inboxPrivateFeedbackTargetPropertyOverrides.propertyId, cycle.propertyId),
        eq(inboxPrivateFeedbackTargetPropertyOverrides.enabled, true),
      ),
    )
    .limit(1)
  const [organizationPolicy] = await tx
    .select({
      durationMinutes: inboxResponseTargetOrganizationPolicies.durationMinutes,
      policyVersion: inboxResponseTargetOrganizationPolicies.policyVersion,
    })
    .from(inboxResponseTargetOrganizationPolicies)
    .where(
      and(
        eq(inboxResponseTargetOrganizationPolicies.organizationId, cycle.organizationId),
        eq(
          inboxResponseTargetOrganizationPolicies.targetKind,
          'private_feedback_handling',
        ),
      ),
    )
    .limit(1)
  const snapshot = buildResponseTargetSnapshot({
    targetKind: 'private_feedback_handling',
    policy: resolvePrivateFeedbackTargetPolicy({
      organizationPolicy: organizationPolicy ?? null,
      propertyOverride:
        propertyPolicy?.durationMinutes === null || propertyPolicy === undefined
          ? null
          : {
              durationMinutes: propertyPolicy.durationMinutes,
              policyVersion: propertyPolicy.policyVersion,
            },
    }),
    startAt: cycle.openedAt,
  })
  await insertMeasuredTarget(tx, cycle, snapshot, createdAt)
}

type StopReason = 'private_feedback_handled' | 'guest_withdrawn'

async function stopPrivateFeedbackTarget(
  tx: Tx,
  current: HandlingCycleHead,
  completedAt: Date,
  stopReason: 'private_feedback_handled',
): Promise<'on_time' | 'late' | 'not_measured'>
async function stopPrivateFeedbackTarget(
  tx: Tx,
  current: HandlingCycleHead,
  completedAt: Date,
  stopReason: 'guest_withdrawn',
): Promise<'cancelled' | 'not_measured'>
async function stopPrivateFeedbackTarget(
  tx: Tx,
  current: HandlingCycleHead,
  completedAt: Date,
  stopReason: StopReason,
): Promise<ResponseTargetResult | 'not_measured'> {
  if (current.sourceType !== 'feedback') {
    throw inboxError('invalid_input', 'Private Feedback Target requires feedback')
  }
  const [target] = await tx
    .select()
    .from(inboxHandlingCycleResponseTargets)
    .where(
      and(
        eq(inboxHandlingCycleResponseTargets.inboxItemId, current.inboxItemId),
        eq(inboxHandlingCycleResponseTargets.cycleNumber, current.currentCycleNumber),
        eq(inboxHandlingCycleResponseTargets.organizationId, current.organizationId),
        eq(inboxHandlingCycleResponseTargets.targetKind, 'private_feedback_handling'),
      ),
    )
    .for('update')
    .limit(1)
  if (!target || target.performanceEligibility !== 'measured') {
    return 'not_measured'
  }
  if (target.completionAt !== null || target.dueAt === null) {
    throw inboxError('revision_conflict', 'Private Feedback Target already stopped')
  }
  const result =
    stopReason === 'guest_withdrawn'
      ? 'cancelled'
      : classifyResponseTargetCompletion(target.dueAt, completedAt)
  const [saved] = await tx
    .update(inboxHandlingCycleResponseTargets)
    .set({
      completionAt: completedAt,
      result,
      stopReason,
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(inboxHandlingCycleResponseTargets.inboxItemId, current.inboxItemId),
        eq(inboxHandlingCycleResponseTargets.cycleNumber, current.currentCycleNumber),
        isNull(inboxHandlingCycleResponseTargets.completionAt),
      ),
    )
    .returning({ inboxItemId: inboxHandlingCycleResponseTargets.inboxItemId })
  if (!saved) {
    throw inboxError('revision_conflict', 'Private Feedback Target changed')
  }
  await tx
    .update(inboxResponseTargetReminders)
    .set({ cancelledAt: completedAt, updatedAt: completedAt })
    .where(
      and(
        eq(inboxResponseTargetReminders.inboxItemId, current.inboxItemId),
        eq(inboxResponseTargetReminders.cycleNumber, current.currentCycleNumber),
        isNull(inboxResponseTargetReminders.deliveredAt),
        isNull(inboxResponseTargetReminders.cancelledAt),
      ),
    )
  return result
}

export const completePrivateFeedbackTarget = (
  tx: Tx,
  current: HandlingCycleHead,
  completedAt: Date,
): Promise<'on_time' | 'late' | 'not_measured'> =>
  stopPrivateFeedbackTarget(tx, current, completedAt, 'private_feedback_handled')

export const cancelPrivateFeedbackTarget = (
  tx: Tx,
  current: HandlingCycleHead,
  cancelledAt: Date,
): Promise<'cancelled' | 'not_measured'> =>
  stopPrivateFeedbackTarget(tx, current, cancelledAt, 'guest_withdrawn')

export type ResponseTargetCancellationReason =
  'superseded_by_source_revision' | 'source_ineligible'

/**
 * Terminalize an unfinished target when its work episode ends without a
 * response outcome. This preserves the immutable snapshot while excluding the
 * interrupted cycle from response-time performance and draining pending slots.
 */
export async function cancelResponseTargetForCycle(
  tx: Tx,
  input: Readonly<{
    inboxItemId: HandlingCycleHead['inboxItemId']
    cycleNumber: number
    organizationId: HandlingCycleHead['organizationId']
    cancelledAt: Date
    reason: ResponseTargetCancellationReason
  }>,
): Promise<'cancelled' | 'not_active'> {
  const [target] = await tx
    .select()
    .from(inboxHandlingCycleResponseTargets)
    .where(
      and(
        eq(inboxHandlingCycleResponseTargets.inboxItemId, input.inboxItemId),
        eq(inboxHandlingCycleResponseTargets.cycleNumber, input.cycleNumber),
        eq(inboxHandlingCycleResponseTargets.organizationId, input.organizationId),
      ),
    )
    .for('update')
    .limit(1)
  if (
    !target ||
    target.performanceEligibility !== 'measured' ||
    target.completionAt !== null
  ) {
    return 'not_active'
  }
  const [saved] = await tx
    .update(inboxHandlingCycleResponseTargets)
    .set({
      completionAt: input.cancelledAt,
      result: 'cancelled',
      stopReason: input.reason,
      updatedAt: input.cancelledAt,
    })
    .where(
      and(
        eq(inboxHandlingCycleResponseTargets.inboxItemId, input.inboxItemId),
        eq(inboxHandlingCycleResponseTargets.cycleNumber, input.cycleNumber),
        isNull(inboxHandlingCycleResponseTargets.completionAt),
      ),
    )
    .returning({ inboxItemId: inboxHandlingCycleResponseTargets.inboxItemId })
  if (!saved) return 'not_active'
  await tx
    .update(inboxResponseTargetReminders)
    .set({ cancelledAt: input.cancelledAt, updatedAt: input.cancelledAt })
    .where(
      and(
        eq(inboxResponseTargetReminders.inboxItemId, input.inboxItemId),
        eq(inboxResponseTargetReminders.cycleNumber, input.cycleNumber),
        isNull(inboxResponseTargetReminders.deliveredAt),
        isNull(inboxResponseTargetReminders.cancelledAt),
      ),
    )
  return 'cancelled'
}

const targetView = (
  row: TargetRow,
  timezone: string,
  now: Date,
  excludedFromReporting: boolean,
): ResponseTargetView => ({
  inboxItemId: inboxItemId(row.inboxItemId),
  cycleNumber: row.cycleNumber,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  targetKind: row.targetKind as ResponseTargetView['targetKind'],
  eligibility: row.performanceEligibility as ResponseTargetView['eligibility'],
  durationMinutes: row.durationMinutes,
  policySource: row.policySource as ResponseTargetView['policySource'],
  policyVersion: row.policyVersion,
  startAt: row.startAt,
  dueAt: row.dueAt,
  completionAt: row.completionAt,
  result: row.result as ResponseTargetView['result'],
  stopReason: row.stopReason as ResponseTargetView['stopReason'],
  propertyTimezone: timezone,
  excludedFromReporting,
  evaluation: evaluateResponseTarget(
    {
      eligibility: row.performanceEligibility as ResponseTargetView['eligibility'],
      startAt: row.startAt,
      dueAt: row.dueAt,
      completionAt: row.completionAt,
      result: row.result as ResponseTargetView['result'],
      excludedFromReporting,
    },
    now,
  ),
})

export const createResponseTargetStore = (db: Database): ResponseTargetStore => ({
  getCycleTarget: async (itemId, orgId, now) =>
    trace('inbox.responseTarget.getCycleTarget', async () => {
      const [row] = await db
        .select({
          target: inboxHandlingCycleResponseTargets,
          timezone: properties.timezone,
          excluded: excludedFromResponseTargetReporting({
            inboxItemId: inboxHandlingCycleResponseTargets.inboxItemId,
            cycleNumber: inboxHandlingCycleResponseTargets.cycleNumber,
            organizationId: inboxHandlingCycleResponseTargets.organizationId,
          }),
        })
        .from(inboxHandlingCycleResponseTargets)
        .innerJoin(
          inboxHandlingCycleHeads,
          and(
            eq(
              inboxHandlingCycleHeads.inboxItemId,
              inboxHandlingCycleResponseTargets.inboxItemId,
            ),
            eq(
              inboxHandlingCycleHeads.currentCycleNumber,
              inboxHandlingCycleResponseTargets.cycleNumber,
            ),
          ),
        )
        .innerJoin(
          properties,
          and(
            eq(
              properties.organizationId,
              inboxHandlingCycleResponseTargets.organizationId,
            ),
            eq(properties.id, inboxHandlingCycleResponseTargets.propertyId),
          ),
        )
        .where(
          and(
            eq(inboxHandlingCycleResponseTargets.inboxItemId, itemId),
            eq(inboxHandlingCycleResponseTargets.organizationId, orgId),
          ),
        )
        .limit(1)
      return row ? targetView(row.target, row.timezone, now, row.excluded) : null
    }),

  // Analytics and per-Property counts, split out for the ratchet: see the module.
  ...createResponseTargetAnalyticsStore(db),

  // Reminder release, split out for the ratchet: see the module.
  ...createReminderReleaseStore(db),

  // An archived Property is outside the workspace, so its pending reminders
  // would only prompt work nobody can do. `cancelled_at` is the slot's own
  // terminal column, so Restore never re-arms a slot (repair rules in
  // docs/operations/inbox-response-targets.md). A Property that is active
  // again by delivery time means the fact arrived late: it cancels nothing.
  // The row is read FOR SHARE so a Restore in flight commits before this
  // decides (and the Restore wins) or waits until the cancellation commits.
  cancelArchivedPropertyRemindersOnce: async ({
    eventId,
    consumerName,
    organizationId: orgId,
    propertyId: pid,
    at,
  }) =>
    trace('inbox.responseTarget.cancelArchivedPropertyRemindersOnce', () =>
      db.transaction(async (tx) => {
        const [property] = await tx
          .select({ lifecycleState: properties.lifecycleState })
          .from(properties)
          .where(and(eq(properties.organizationId, orgId), eq(properties.id, pid)))
          .for('share')
          .limit(1)
        const status =
          property && property.lifecycleState !== 'active' ? 'applied' : 'obsolete'
        const reserved = await tx
          .insert(eventConsumerReceipts)
          .values({ eventId, consumerName, status })
          .onConflictDoNothing()
          .returning({ eventId: eventConsumerReceipts.eventId })
        if (reserved.length === 0) return 'duplicate'
        if (status === 'applied') {
          await tx
            .update(inboxResponseTargetReminders)
            .set({
              cancelledAt: at,
              updatedAt: sql`GREATEST(${inboxResponseTargetReminders.updatedAt}, ${at}::timestamptz)`,
            })
            .where(
              and(
                eq(inboxResponseTargetReminders.organizationId, orgId),
                eq(inboxResponseTargetReminders.propertyId, pid),
                isNull(inboxResponseTargetReminders.deliveredAt),
                isNull(inboxResponseTargetReminders.cancelledAt),
              ),
            )
        }
        return status
      }),
    ),
})
