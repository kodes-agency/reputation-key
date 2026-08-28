import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleResponseTargets,
  inboxPrivateFeedbackTargetPropertyOverrides,
  inboxResponseTargetOrganizationPolicies,
  inboxResponseTargetReminders,
} from '#/shared/db/schema/inbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { inboxItemId, organizationId, propertyId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
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
  type ResponseTargetResult,
} from '../domain/response-target'
import { inboxResponseTargetReminderDue } from '../domain/events'
import { inboxError } from '../domain/errors'

type TargetRow = typeof inboxHandlingCycleResponseTargets.$inferSelect

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
  if (
    reviewAuthority !== undefined &&
    reviewAuthority.authority !== 'review.current-response-target.v1' &&
    reviewAuthority.authority !== 'review.inbox-projection-revision.v1'
  ) {
    throw inboxError('invalid_input', 'Review Response Target authority is invalid')
  }
  if (
    reviewAuthority !== undefined &&
    (reviewAuthority.organizationId !== cycle.organizationId ||
      reviewAuthority.propertyId !== cycle.propertyId ||
      reviewAuthority.reviewId !== cycle.sourceId ||
      reviewAuthority.materialReviewRevision !== cycle.sourceRevision)
  ) {
    throw inboxError(
      'invalid_input',
      'Review Response Target authority does not match the Handling Cycle',
    )
  }
  if (
    reviewAuthority?.authority === 'review.inbox-projection-revision.v1' &&
    cycle.openedReason !== 'review_observed' &&
    cycle.openedReason !== 'material_revision_changed'
  ) {
    throw inboxError(
      'invalid_input',
      'Historical Review authority is limited to source-event projection cycles',
    )
  }
  const eligibility = reviewAuthority?.eligibility ?? 'legacy_unknown'
  const startAt = reviewAuthority?.responseTargetStartAt ?? null
  if ((eligibility === 'measured') !== startAt instanceof Date) {
    throw inboxError('invalid_input', 'Review Response Target provenance is invalid')
  }
  if (targetAnchor?.targetStart.basis === 'operational_reopen') {
    if (reviewAuthority?.authority !== 'review.current-response-target.v1') {
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
      policy: resolveGoogleReviewTargetPolicy(organizationPolicy ?? null),
      startAt,
    })
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
    await tx.insert(inboxResponseTargetReminders).values(
      snapshot.reminders.map((reminder) => ({
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
  await tx.insert(inboxResponseTargetReminders).values(
    snapshot.reminders.map((reminder) => ({
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

/** Stop a measured Review target only after exact current Google truth is live. */
export async function completeGoogleReviewTarget(
  tx: Tx,
  current: HandlingCycleHead,
  completedAt: Date,
): Promise<'on_time' | 'late' | 'not_measured'> {
  if (current.sourceType !== 'review') {
    throw inboxError('invalid_input', 'Google Review Response Target requires review')
  }
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
    return 'not_measured'
  }
  if (target.completionAt !== null || target.dueAt === null) {
    throw inboxError('revision_conflict', 'Google Review Response Target already stopped')
  }
  const result = classifyResponseTargetCompletion(target.dueAt, completedAt)
  const [saved] = await tx
    .update(inboxHandlingCycleResponseTargets)
    .set({
      completionAt: completedAt,
      result,
      stopReason: 'confirmed_on_google',
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
    throw inboxError('revision_conflict', 'Google Review Response Target changed')
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

const targetView = (row: TargetRow, timezone: string, now: Date): ResponseTargetView => ({
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
  evaluation: evaluateResponseTarget(
    {
      eligibility: row.performanceEligibility as ResponseTargetView['eligibility'],
      startAt: row.startAt,
      dueAt: row.dueAt,
      completionAt: row.completionAt,
      result: row.result as ResponseTargetView['result'],
    },
    now,
  ),
})

export const createResponseTargetStore = (
  db: Database,
  events: EventBus,
): ResponseTargetStore => ({
  getCycleTarget: async (itemId, orgId, now) =>
    trace('inbox.responseTarget.getCycleTarget', async () => {
      const [row] = await db
        .select({
          target: inboxHandlingCycleResponseTargets,
          timezone: properties.timezone,
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
      return row ? targetView(row.target, row.timezone, now) : null
    }),

  getPrivateFeedbackAnalytics: async ({ organizationId: orgId, propertyIds, now }) =>
    trace('inbox.responseTarget.getPrivateFeedbackAnalytics', async () => {
      if (propertyIds !== null && propertyIds.length === 0) {
        return {
          targetKind: 'private_feedback_handling',
          measuredCycleCount: 0,
          activeCount: 0,
          currentOverdueCount: 0,
          handledOnTimeCount: 0,
          handledLateCount: 0,
          reopenCount: 0,
          averageTimeToFirstHandlingMinutes: null,
        }
      }
      const propertyFilter =
        propertyIds === null
          ? sql``
          : sql`AND target.property_id IN (${sql.join(
              propertyIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
      const rows = await db.execute<{
        measured_cycle_count: number
        active_count: number
        current_overdue_count: number
        handled_on_time_count: number
        handled_late_count: number
        reopen_count: number
        average_time_to_first_handling_minutes: number | null
      }>(sql`
        SELECT
          count(*) FILTER (WHERE target.result IS DISTINCT FROM 'cancelled')::integer AS measured_cycle_count,
          count(*) FILTER (
            WHERE target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
          )::integer AS active_count,
          count(*) FILTER (
            WHERE target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
              AND target.due_at <= ${now}
          )::integer AS current_overdue_count,
          count(*) FILTER (WHERE target.result = 'on_time')::integer AS handled_on_time_count,
          count(*) FILTER (WHERE target.result = 'late')::integer AS handled_late_count,
          count(*) FILTER (
            WHERE cycle.opened_reason = 'manual_reopen'
              AND target.result IS DISTINCT FROM 'cancelled'
          )::integer AS reopen_count,
          avg(
            extract(epoch FROM (target.completion_at - target.start_at)) / 60
          ) FILTER (WHERE target.result IN ('on_time', 'late'))::real
            AS average_time_to_first_handling_minutes
        FROM ${inboxHandlingCycleResponseTargets} target
        INNER JOIN ${inboxHandlingCycleHeads} head
          ON head.inbox_item_id = target.inbox_item_id
        INNER JOIN inbox_handling_cycles cycle
          ON cycle.inbox_item_id = target.inbox_item_id
         AND cycle.cycle_number = target.cycle_number
        WHERE target.organization_id = ${orgId}
          AND target.target_kind = 'private_feedback_handling'
          AND target.performance_eligibility = 'measured'
          ${propertyFilter}
      `)
      const row = rows.rows[0]
      return {
        targetKind: 'private_feedback_handling',
        measuredCycleCount: row?.measured_cycle_count ?? 0,
        activeCount: row?.active_count ?? 0,
        currentOverdueCount: row?.current_overdue_count ?? 0,
        handledOnTimeCount: row?.handled_on_time_count ?? 0,
        handledLateCount: row?.handled_late_count ?? 0,
        reopenCount: row?.reopen_count ?? 0,
        averageTimeToFirstHandlingMinutes:
          row?.average_time_to_first_handling_minutes ?? null,
      } satisfies PrivateFeedbackTargetAnalytics
    }),

  getGoogleReviewAnalytics: async ({ organizationId: orgId, propertyIds, now }) =>
    trace('inbox.responseTarget.getGoogleReviewAnalytics', async () => {
      if (propertyIds !== null && propertyIds.length === 0) {
        return {
          targetKind: 'google_review_response',
          measuredCycleCount: 0,
          activeCount: 0,
          currentOverdueCount: 0,
          respondedOnTimeCount: 0,
          respondedLateCount: 0,
          reopenCount: 0,
          historicalOnboardingExcludedCount: 0,
          legacyUnknownExcludedCount: 0,
          averageTimeToResponseMinutes: null,
        }
      }
      const propertyFilter =
        propertyIds === null
          ? sql``
          : sql`AND target.property_id IN (${sql.join(
              propertyIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
      const rows = await db.execute<{
        measured_cycle_count: number
        active_count: number
        current_overdue_count: number
        responded_on_time_count: number
        responded_late_count: number
        reopen_count: number
        historical_onboarding_excluded_count: number
        legacy_unknown_excluded_count: number
        average_time_to_response_minutes: number | null
      }>(sql`
        SELECT
          count(*) FILTER (
            WHERE target.performance_eligibility = 'measured'
              AND target.result IS DISTINCT FROM 'cancelled'
          )::integer AS measured_cycle_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'measured'
              AND target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
          )::integer AS active_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'measured'
              AND target.completion_at IS NULL
              AND head.current_cycle_number = target.cycle_number
              AND head.status = 'open'
              AND target.due_at <= ${now}
          )::integer AS current_overdue_count,
          count(*) FILTER (WHERE target.result = 'on_time')::integer
            AS responded_on_time_count,
          count(*) FILTER (WHERE target.result = 'late')::integer
            AS responded_late_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'measured'
              AND target.result IS DISTINCT FROM 'cancelled'
              AND cycle.opened_reason IN ('manual_reopen', 'provider_reply_deleted')
          )::integer AS reopen_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'historical_onboarding'
          )::integer AS historical_onboarding_excluded_count,
          count(*) FILTER (
            WHERE target.performance_eligibility = 'legacy_unknown'
          )::integer AS legacy_unknown_excluded_count,
          avg(
            extract(epoch FROM (target.completion_at - target.start_at)) / 60
          ) FILTER (WHERE target.result IN ('on_time', 'late'))::real
            AS average_time_to_response_minutes
        FROM ${inboxHandlingCycleResponseTargets} target
        INNER JOIN ${inboxHandlingCycleHeads} head
          ON head.inbox_item_id = target.inbox_item_id
        INNER JOIN inbox_handling_cycles cycle
          ON cycle.inbox_item_id = target.inbox_item_id
         AND cycle.cycle_number = target.cycle_number
        WHERE target.organization_id = ${orgId}
          AND target.target_kind = 'google_review_response'
          ${propertyFilter}
      `)
      const row = rows.rows[0]
      return {
        targetKind: 'google_review_response',
        measuredCycleCount: row?.measured_cycle_count ?? 0,
        activeCount: row?.active_count ?? 0,
        currentOverdueCount: row?.current_overdue_count ?? 0,
        respondedOnTimeCount: row?.responded_on_time_count ?? 0,
        respondedLateCount: row?.responded_late_count ?? 0,
        reopenCount: row?.reopen_count ?? 0,
        historicalOnboardingExcludedCount: row?.historical_onboarding_excluded_count ?? 0,
        legacyUnknownExcludedCount: row?.legacy_unknown_excluded_count ?? 0,
        averageTimeToResponseMinutes: row?.average_time_to_response_minutes ?? null,
      } satisfies GoogleReviewTargetAnalytics
    }),

  releaseDueReminders: async ({ now, limit }) =>
    trace('inbox.responseTarget.releaseDueReminders', async () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw inboxError('invalid_input', 'Reminder batch limit must be 1–100')
      }
      const facts = await db.transaction(async (tx) => {
        const due = await tx
          .select({ reminder: inboxResponseTargetReminders })
          .from(inboxResponseTargetReminders)
          .innerJoin(
            inboxHandlingCycleResponseTargets,
            and(
              eq(
                inboxHandlingCycleResponseTargets.inboxItemId,
                inboxResponseTargetReminders.inboxItemId,
              ),
              eq(
                inboxHandlingCycleResponseTargets.cycleNumber,
                inboxResponseTargetReminders.cycleNumber,
              ),
              isNull(inboxHandlingCycleResponseTargets.completionAt),
              eq(inboxHandlingCycleResponseTargets.performanceEligibility, 'measured'),
            ),
          )
          .innerJoin(
            inboxHandlingCycleHeads,
            and(
              eq(
                inboxHandlingCycleHeads.inboxItemId,
                inboxResponseTargetReminders.inboxItemId,
              ),
              eq(
                inboxHandlingCycleHeads.currentCycleNumber,
                inboxResponseTargetReminders.cycleNumber,
              ),
              eq(inboxHandlingCycleHeads.status, 'open'),
            ),
          )
          .where(
            and(
              lte(inboxResponseTargetReminders.scheduledFor, now),
              isNull(inboxResponseTargetReminders.deliveredAt),
              isNull(inboxResponseTargetReminders.cancelledAt),
            ),
          )
          .orderBy(
            asc(inboxResponseTargetReminders.scheduledFor),
            asc(inboxResponseTargetReminders.inboxItemId),
            asc(inboxResponseTargetReminders.reminderKind),
          )
          .limit(limit)
          // Lock the target before its reminder, matching completion/cancellation.
          // This makes "still active" and reminder release one ordered decision:
          // a concurrently completed target cannot publish a later due fact.
          .for('update', {
            of: inboxHandlingCycleResponseTargets,
            skipLocked: true,
          })
        const emitted = []
        for (const { reminder } of due) {
          const [saved] = await tx
            .update(inboxResponseTargetReminders)
            .set({ deliveredAt: now, updatedAt: now })
            .where(
              and(
                eq(inboxResponseTargetReminders.inboxItemId, reminder.inboxItemId),
                eq(inboxResponseTargetReminders.cycleNumber, reminder.cycleNumber),
                eq(inboxResponseTargetReminders.reminderKind, reminder.reminderKind),
                isNull(inboxResponseTargetReminders.deliveredAt),
                isNull(inboxResponseTargetReminders.cancelledAt),
              ),
            )
            .returning({ eventId: inboxResponseTargetReminders.eventId })
          if (!saved) continue
          const fact = inboxResponseTargetReminderDue({
            inboxItemId: inboxItemId(reminder.inboxItemId),
            cycleNumber: reminder.cycleNumber,
            organizationId: organizationId(reminder.organizationId),
            propertyId: propertyId(reminder.propertyId),
            targetKind: reminder.targetKind as ResponseTargetView['targetKind'],
            reminderKind:
              reminder.reminderKind === 'halfway' ? 'halfway' : 'target_passed',
            scheduledFor: reminder.scheduledFor,
            occurredAt: now,
          })
          await insertOutboxRow(tx, fact, { recordedAt: now })
          emitted.push(fact)
        }
        return emitted
      })
      for (const fact of facts) await emitAfterCommit(events, fact)
      return { released: facts.length }
    }),
})
