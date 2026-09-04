// Inbox context — the single reader of `inbox_handling_cycle_transitions`.
//
// The transitions log was long described as write-only, and it never was: the
// private-feedback store already reads it to answer "why did this cycle close".
// The Handling History read model needs the same log, and two independent
// readers would eventually disagree about ordering — which, for an append-only
// log whose whole purpose is to be replayable, is a correctness bug rather than
// a style problem.
//
// So both reads live here and share one ordering key: `state_revision`. It is
// the composite key's own monotonic component, which makes replay and reorder
// inert; `transitioned_at` is a wall-clock stamp and is deliberately NOT the
// ordering key.

import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxHandlingCycleTransitions } from '#/shared/db/schema/inbox.schema'
import type { Tx } from '#/shared/outbox/commit'
import { SOURCE_UNAVAILABLE_CLOSE_REASONS } from '../domain/handling-outcome-authority'

/** Either a pooled handle or an open transaction may read the log. */
export type TransitionReader = Pick<Database, 'select'> | Tx

export type HandlingCycleTransitionRow = Readonly<{
  inboxItemId: string
  stateRevision: number
  cycleNumber: number
  kind: string
  transitionReason: string
  actorType: string
  actorUserId: string | null
  transitionedAt: Date
}>

/**
 * Latest close reason for one cycle. Ordered by descending state revision, so a
 * corrected or replayed close never resurrects an older reason.
 */
export async function selectCycleCloseReason(
  tx: TransitionReader,
  input: Readonly<{
    inboxItemId: string
    organizationId: string
    cycleNumber: number
  }>,
): Promise<string | null> {
  const [row] = await tx
    .select({ reason: inboxHandlingCycleTransitions.transitionReason })
    .from(inboxHandlingCycleTransitions)
    .where(
      and(
        eq(inboxHandlingCycleTransitions.inboxItemId, input.inboxItemId),
        eq(inboxHandlingCycleTransitions.organizationId, input.organizationId),
        eq(inboxHandlingCycleTransitions.cycleNumber, input.cycleNumber),
        eq(inboxHandlingCycleTransitions.kind, 'closed'),
      ),
    )
    .orderBy(desc(inboxHandlingCycleTransitions.stateRevision))
    .limit(1)
  return row?.reason ?? null
}

/**
 * Every retention / redaction / source-unavailable closure ever recorded for
 * one Inbox Item, across every cycle. Unbounded by cycle on purpose: the rule
 * it feeds (domain/handling-outcome-authority.ts) is one-way, so a withdrawal
 * on cycle 1 must still be visible while cycle 7 is open. The result set is
 * bounded by the two reason literals, not by row count.
 */
export async function selectSourceUnavailableCloseReasons(
  tx: TransitionReader,
  input: Readonly<{ inboxItemId: string; organizationId: string }>,
): Promise<readonly string[]> {
  const rows = await tx
    .select({ reason: inboxHandlingCycleTransitions.transitionReason })
    .from(inboxHandlingCycleTransitions)
    .where(
      and(
        eq(inboxHandlingCycleTransitions.inboxItemId, input.inboxItemId),
        eq(inboxHandlingCycleTransitions.organizationId, input.organizationId),
        eq(inboxHandlingCycleTransitions.kind, 'closed'),
        inArray(inboxHandlingCycleTransitions.transitionReason, [
          ...SOURCE_UNAVAILABLE_CLOSE_REASONS,
        ]),
      ),
    )
  return [...new Set(rows.map((row) => row.reason))]
}

/**
 * The whole transition log for one Inbox Item, tenant-fenced and bounded.
 * Ascending state revision — the same key `selectCycleCloseReason` orders by,
 * read forwards because history is told forwards.
 */
export async function selectHandlingCycleTransitions(
  tx: TransitionReader,
  input: Readonly<{ inboxItemId: string; organizationId: string; limit: number }>,
): Promise<readonly HandlingCycleTransitionRow[]> {
  const rows = await tx
    .select({
      inboxItemId: inboxHandlingCycleTransitions.inboxItemId,
      stateRevision: inboxHandlingCycleTransitions.stateRevision,
      cycleNumber: inboxHandlingCycleTransitions.cycleNumber,
      kind: inboxHandlingCycleTransitions.kind,
      transitionReason: inboxHandlingCycleTransitions.transitionReason,
      actorType: inboxHandlingCycleTransitions.actorType,
      actorUserId: inboxHandlingCycleTransitions.actorUserId,
      transitionedAt: inboxHandlingCycleTransitions.transitionedAt,
    })
    .from(inboxHandlingCycleTransitions)
    .where(
      and(
        eq(inboxHandlingCycleTransitions.inboxItemId, input.inboxItemId),
        eq(inboxHandlingCycleTransitions.organizationId, input.organizationId),
      ),
    )
    .orderBy(asc(inboxHandlingCycleTransitions.stateRevision))
    .limit(input.limit)
  return rows
}
