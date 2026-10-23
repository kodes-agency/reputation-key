// Inbox context — leaving the Response Targets of restated revisions out of
// every count (migration 0070; docs/operations/inbox-response-targets.md).
//
// Google restated 62 Reviews on 2026-10-23 without moving their `updateTime`,
// Review minted a revision for each, and Inbox opened a Handling Cycle for it
// with a Response Target whose clock started at the old `updateTime`. Cycles
// and completed targets are immutable history (ADR 0055), so the repair is an
// append-only row beside the target: `inbox_response_target_exclusions`. Every
// counting reader skips a cycle that has one; the target still closes with its
// cycle.
//
// Review owns the list of restated revisions and Inbox may not read Review
// tables, so the operator command passes that list in. This store finds the
// cycles that list names (`scan`) and writes the rows (`apply`).
//
// `apply` works one item per transaction, in the lock order head, item,
// target, reminders, with `organization_id` on every statement. It writes the
// ledger row and cancels the cycle's still-pending reminder slots through the
// slots' own one-shot column. It moves no `state_revision` or
// `command_revision` and touches no cycle, transition, target, item or
// notification.

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notExcludedFromResponseTargetReporting,
  aliasedResponseTargetKey,
} from '#/shared/db/inbox-response-target-exclusions'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycleResponseTargets,
  inboxHandlingCycles,
  inboxItems,
  inboxResponseTargetReminders,
} from '#/shared/db/schema/inbox.schema'
import { inboxResponseTargetExclusions } from '#/shared/db/schema/inbox-response-target-exclusions.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { inboxItemId, organizationId, propertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { Tx } from '#/shared/outbox/commit'
import type {
  CandidateExclusionOutcome,
  CandidateExclusionResult,
  ExclusionAudit,
  ExclusionCandidate,
  ExclusionItemStatus,
  ExclusionScope,
  ExclusionTargetState,
  RestatedRevisionExclusionScan,
  RestatedRevisionRef,
  RestatedRevisionTargetExclusions,
} from '../application/ports/restated-revision-target-exclusion.port'

type ScanRow = Readonly<{
  inbox_item_id: string
  cycle_number: number | string
  review_id: string
  revision: number | string
  item_status: string
  target_state: string
  pending_slots: number | string
}>

const ITEM_STATUSES: ReadonlySet<string> = new Set<ExclusionItemStatus>([
  'open',
  'closed',
])
const TARGET_STATES: ReadonlySet<string> = new Set<ExclusionTargetState>([
  'open',
  'on_time',
  'late',
  'cancelled',
])

function candidateFromRow(row: ScanRow): ExclusionCandidate {
  if (!ITEM_STATUSES.has(row.item_status) || !TARGET_STATES.has(row.target_state)) {
    throw new Error('restated revision scan returned a state it does not know')
  }
  return {
    inboxItemId: inboxItemId(row.inbox_item_id),
    cycleNumber: Number(row.cycle_number),
    reviewId: row.review_id,
    revision: Number(row.revision),
    itemStatus: row.item_status as ExclusionItemStatus,
    targetState: row.target_state as ExclusionTargetState,
    pendingReminderSlots: Number(row.pending_slots),
  }
}

/**
 * The cycles of the Property that Review's restated revisions opened: a review
 * item's `material_revision_changed` cycle on one of those revisions, with a
 * measured Google target and no exclusion yet. The pairs are matched in the
 * database, so the list can be as long as the Property has Reviews.
 */
async function scanCandidates(
  db: Database,
  scope: ExclusionScope,
  restated: ReadonlyArray<RestatedRevisionRef>,
): Promise<ReadonlyArray<ExclusionCandidate>> {
  if (restated.length === 0) return []
  const reviewIds = restated.map((ref) => ref.reviewId)
  const revisions = restated.map((ref) => ref.revision)
  const rows = await db.execute<ScanRow>(sql`
    SELECT
      cycle.inbox_item_id,
      cycle.cycle_number,
      cycle.review_id,
      cycle.material_review_revision AS revision,
      item.status AS item_status,
      CASE WHEN target.completion_at IS NULL THEN 'open' ELSE target.result END AS target_state,
      (
        SELECT count(*)::integer
        FROM inbox_response_target_reminders slot
        WHERE slot.organization_id = ${scope.organizationId}
          AND slot.inbox_item_id = target.inbox_item_id
          AND slot.cycle_number = target.cycle_number
          AND slot.delivered_at IS NULL
          AND slot.cancelled_at IS NULL
      ) AS pending_slots
    FROM inbox_handling_cycles cycle
    INNER JOIN unnest(${sql.param(reviewIds)}::uuid[], ${sql.param(revisions)}::bigint[])
      AS restated(review_id, revision)
      ON restated.review_id = cycle.review_id
     AND restated.revision = cycle.material_review_revision
    INNER JOIN inbox_items item
      ON item.id = cycle.inbox_item_id
     AND item.organization_id = cycle.organization_id
    INNER JOIN inbox_handling_cycle_response_targets target
      ON target.inbox_item_id = cycle.inbox_item_id
     AND target.cycle_number = cycle.cycle_number
     AND target.organization_id = cycle.organization_id
    WHERE cycle.organization_id = ${scope.organizationId}
      AND cycle.property_id = ${scope.propertyId}
      AND cycle.source_type = 'review'
      AND cycle.opened_reason = 'material_revision_changed'
      AND target.target_kind = 'google_review_response'
      AND target.performance_eligibility = 'measured'
      AND ${notExcludedFromResponseTargetReporting(aliasedResponseTargetKey('target'))}
    ORDER BY cycle.inbox_item_id, cycle.cycle_number
  `)
  return rows.rows.map(candidateFromRow)
}

/** Lock the item's head, then the item: the order every Review projection takes. */
async function lockHeadThenItem(
  tx: Tx,
  scope: ExclusionScope,
  candidate: ExclusionCandidate,
): Promise<boolean> {
  const [head] = await tx
    .select({ inboxItemId: inboxHandlingCycleHeads.inboxItemId })
    .from(inboxHandlingCycleHeads)
    .where(
      and(
        eq(inboxHandlingCycleHeads.inboxItemId, candidate.inboxItemId),
        eq(inboxHandlingCycleHeads.organizationId, scope.organizationId),
        eq(inboxHandlingCycleHeads.propertyId, scope.propertyId),
        eq(inboxHandlingCycleHeads.sourceType, 'review'),
        eq(inboxHandlingCycleHeads.sourceId, candidate.reviewId),
      ),
    )
    .for('update')
    .limit(1)
  if (!head) return false
  const [item] = await tx
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, candidate.inboxItemId),
        eq(inboxItems.organizationId, scope.organizationId),
        eq(inboxItems.sourceType, 'review'),
        eq(inboxItems.sourceId, candidate.reviewId),
      ),
    )
    .for('update')
    .limit(1)
  return item !== undefined
}

/** The cycle is still the one opened for this revision of this Review. */
async function cycleStillRecorded(
  tx: Tx,
  scope: ExclusionScope,
  candidate: ExclusionCandidate,
): Promise<boolean> {
  const [cycle] = await tx
    .select({ openedReason: inboxHandlingCycles.openedReason })
    .from(inboxHandlingCycles)
    .where(
      and(
        eq(inboxHandlingCycles.inboxItemId, candidate.inboxItemId),
        eq(inboxHandlingCycles.cycleNumber, candidate.cycleNumber),
        eq(inboxHandlingCycles.organizationId, scope.organizationId),
        eq(inboxHandlingCycles.propertyId, scope.propertyId),
        eq(inboxHandlingCycles.sourceType, 'review'),
        eq(inboxHandlingCycles.reviewId, candidate.reviewId),
        eq(inboxHandlingCycles.materialReviewRevision, candidate.revision),
      ),
    )
    .limit(1)
  return cycle?.openedReason === 'material_revision_changed'
}

async function lockMeasuredGoogleTarget(
  tx: Tx,
  scope: ExclusionScope,
  candidate: ExclusionCandidate,
): Promise<boolean> {
  const [target] = await tx
    .select({ eligibility: inboxHandlingCycleResponseTargets.performanceEligibility })
    .from(inboxHandlingCycleResponseTargets)
    .where(
      and(
        eq(inboxHandlingCycleResponseTargets.inboxItemId, candidate.inboxItemId),
        eq(inboxHandlingCycleResponseTargets.cycleNumber, candidate.cycleNumber),
        eq(inboxHandlingCycleResponseTargets.organizationId, scope.organizationId),
        eq(inboxHandlingCycleResponseTargets.propertyId, scope.propertyId),
        eq(inboxHandlingCycleResponseTargets.targetKind, 'google_review_response'),
      ),
    )
    .for('update')
    .limit(1)
  return target?.eligibility === 'measured'
}

/** The slots' own one-shot column: both of their terminal columns still empty. */
async function cancelPendingSlots(
  tx: Tx,
  scope: ExclusionScope,
  candidate: ExclusionCandidate,
  at: Date,
): Promise<number> {
  const cancelled = await tx
    .update(inboxResponseTargetReminders)
    .set({
      cancelledAt: at,
      updatedAt: sql`GREATEST(${inboxResponseTargetReminders.updatedAt}, ${at}::timestamptz)`,
    })
    .where(
      and(
        eq(inboxResponseTargetReminders.inboxItemId, candidate.inboxItemId),
        eq(inboxResponseTargetReminders.cycleNumber, candidate.cycleNumber),
        eq(inboxResponseTargetReminders.organizationId, scope.organizationId),
        isNull(inboxResponseTargetReminders.deliveredAt),
        isNull(inboxResponseTargetReminders.cancelledAt),
      ),
    )
    .returning({ kind: inboxResponseTargetReminders.reminderKind })
  return cancelled.length
}

async function insertExclusion(
  tx: Tx,
  scope: ExclusionScope,
  candidate: ExclusionCandidate,
  audit: ExclusionAudit,
): Promise<boolean> {
  const inserted = await tx
    .insert(inboxResponseTargetExclusions)
    .values({
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      inboxItemId: candidate.inboxItemId,
      cycleNumber: candidate.cycleNumber,
      targetKind: 'google_review_response',
      reason: 'provider_restatement',
      correlationId: audit.correlationId,
      operatorId: audit.operatorId,
      ticket: audit.ticket,
      recordedAt: audit.at,
    })
    .onConflictDoNothing()
    .returning({ inboxItemId: inboxResponseTargetExclusions.inboxItemId })
  return inserted.length > 0
}

type Verdict =
  | Readonly<{
      outcome: Exclude<CandidateExclusionOutcome, 'excluded' | 'already_excluded'>
    }>
  | Readonly<{ outcome: 'excluded' | 'already_excluded'; cancelledReminderSlots: number }>

/** One candidate in one transaction: head, item, target, then the slots. */
async function excludeOne(
  db: Database,
  scope: ExclusionScope,
  candidate: ExclusionCandidate,
  audit: ExclusionAudit,
): Promise<CandidateExclusionResult> {
  const verdict: Verdict = await db.transaction(async (tx) => {
    if (
      !(await lockHeadThenItem(tx, scope, candidate)) ||
      !(await cycleStillRecorded(tx, scope, candidate))
    ) {
      return { outcome: 'refused_cycle_changed' }
    }
    if (!(await lockMeasuredGoogleTarget(tx, scope, candidate))) {
      return { outcome: 'refused_target_not_measured' }
    }
    const inserted = await insertExclusion(tx, scope, candidate, audit)
    const cancelledReminderSlots = await cancelPendingSlots(
      tx,
      scope,
      candidate,
      audit.at,
    )
    return {
      outcome: inserted ? 'excluded' : 'already_excluded',
      cancelledReminderSlots,
    }
  })
  return {
    inboxItemId: candidate.inboxItemId,
    cycleNumber: candidate.cycleNumber,
    outcome: verdict.outcome,
    cancelledReminderSlots:
      'cancelledReminderSlots' in verdict ? verdict.cancelledReminderSlots : 0,
  }
}

export const createRestatedRevisionTargetExclusionStore = (
  db: Database,
): RestatedRevisionTargetExclusions => ({
  findProperty: (id) =>
    trace('inbox.restatedRevisionTargets.findProperty', async () => {
      const [row] = await db
        .select({ organizationId: properties.organizationId, id: properties.id })
        .from(properties)
        .where(eq(properties.id, id))
        .limit(1)
      return row
        ? {
            organizationId: organizationId(row.organizationId),
            propertyId: propertyId(row.id),
          }
        : null
    }),

  scan: ({ scope, restated }) =>
    trace(
      'inbox.restatedRevisionTargets.scan',
      async (): Promise<RestatedRevisionExclusionScan> => ({
        scope,
        candidates: await scanCandidates(db, scope, restated),
      }),
    ),

  apply: ({ scope, candidates, audit }) =>
    trace('inbox.restatedRevisionTargets.apply', async () => {
      const results: CandidateExclusionResult[] = []
      for (const candidate of candidates) {
        results.push(await excludeOne(db, scope, candidate, audit))
      }
      return results
    }),
})
