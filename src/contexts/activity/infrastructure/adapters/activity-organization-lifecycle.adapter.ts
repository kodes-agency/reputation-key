// Activity's Organization lifecycle contribution (LIF-01 T12/T13/T14).
//
// Activity owns two things that this file must keep strictly apart:
//
//   * Recent Activity — a 90-day projection of tenant work (`recent_activity_
//     entries`), its content-free reconstruction authority (`recent_activity_
//     replay_facts`) and its actor-label privacy fence. This is tenant content
//     and Purge removes it.
//   * Operational Action History — the restricted, minimal, identifier-only
//     record of who did what (`operational_action_history_records`, its
//     sequence `_heads` and its `_legal_holds`). Program bullet 5 keeps this as
//     independently required evidence, so it is NOT purged with the tenant.
//     Migration 0149 makes that structural rather than merely intended: the
//     append-only guards reject DELETE and TRUNCATE outright, permit only
//     hold-aware identifier redaction on UPDATE, and its retention mode is
//     still `report_only_pending_counsel` — there is no counsel-approved
//     destructive lifecycle for it to participate in.
//
// What Activity contributes per phase:
//   * Closing verifies that Activity has no effect left to stop, and mutates
//     nothing (see `prepareClosing` for why that is the honest answer here).
//   * Purge readiness is read only and FAILS CLOSED on an active legal hold,
//     so a hold stops the irreversible boundary for the whole Organization.
//   * Purge scrubs Recent Activity and re-checks the hold before it does.
//
// The transaction, advisory lock, authority binding, fingerprint and
// content-free receipt all come from the shared receipt store; this file only
// supplies the three reviewed phase bodies.

import { count, eq, isNull, and, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  validateContentFreeEvidenceRef,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import {
  operationalActionHistoryLegalHolds,
  recentActivityActorLabelRedactions,
  recentActivityEntries,
  recentActivityReplayFacts,
} from '#/shared/db/schema/activity.schema'
import type { Tx } from '#/shared/outbox/commit'
// Cross-context adapter contract: src/contexts/CONTEXT.md "Dependency rules"
// lets a foreign infrastructure/adapters/** module import the Identity port it
// implements, and nothing else from Identity.
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'

export type ActivityLifecycleProjectionCounts = Readonly<{
  entries: number
  replayFacts: number
  actorLabelRedactions: number
}>

const total = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0)

const projectionTotal = (counts: ActivityLifecycleProjectionCounts): number =>
  total([counts.entries, counts.replayFacts, counts.actorLabelRedactions])

/**
 * `count(*)` for one bounded, organization-scoped predicate.
 *
 * `where` is nullable because Drizzle's `and()` is: an accidentally empty
 * predicate must be visible as a type, not silently widened to a full scan.
 */
const countRows = async (
  tx: Tx,
  table: PgTable,
  where: SQL | undefined,
): Promise<number> => {
  if (!where) throw new Error('Activity lifecycle count requires a bound scope')
  const rows = await tx.select({ value: count() }).from(table).where(where)
  return rows[0]?.value ?? 0
}

/** Unreleased legal holds for this tenant, whatever interval they protect. */
const countActiveLegalHolds = (tx: Tx, organizationId: string): Promise<number> =>
  countRows(
    tx,
    operationalActionHistoryLegalHolds,
    and(
      eq(operationalActionHistoryLegalHolds.organizationId, organizationId),
      isNull(operationalActionHistoryLegalHolds.releasedAt),
    ),
  )

const readProjectionCounts = async (
  tx: Tx,
  organizationId: string,
): Promise<ActivityLifecycleProjectionCounts> => ({
  entries: await countRows(
    tx,
    recentActivityEntries,
    eq(recentActivityEntries.organizationId, organizationId),
  ),
  replayFacts: await countRows(
    tx,
    recentActivityReplayFacts,
    eq(recentActivityReplayFacts.organizationId, organizationId),
  ),
  actorLabelRedactions: await countRows(
    tx,
    recentActivityActorLabelRedactions,
    eq(recentActivityActorLabelRedactions.organizationId, organizationId),
  ),
})

/**
 * Evidence references carry identifiers, enums and counts only — never an
 * actor name, avatar URL, resource label or activity payload. Each is
 * validated against the same content-free grammar the receipt column enforces.
 */
export const activityClosingEvidenceRef = (
  counts: ActivityLifecycleProjectionCounts,
): string =>
  validateContentFreeEvidenceRef(
    `activity:closing:frozen:entry-${counts.entries}:replay-${counts.replayFacts}`,
  )

export const activityReadinessEvidenceRef = (
  counts: ActivityLifecycleProjectionCounts,
): string =>
  validateContentFreeEvidenceRef(
    `activity:purge_readiness:row-${projectionTotal(counts)}`,
  )

export const activityPurgeEvidenceRef = (
  counts: ActivityLifecycleProjectionCounts,
): string =>
  validateContentFreeEvidenceRef(
    [
      'activity:purge',
      `entry-${counts.entries}`,
      `replay-${counts.replayFacts}`,
      `redaction-${counts.actorLabelRedactions}`,
    ].join(':'),
  )

/**
 * `no_data` is an affirmative answer, not an omission: an Organization with no
 * Recent Activity still returns a receipt, because a missing contributor would
 * make a partial purge look complete.
 */
export const activityClosingOutcome = (
  counts: ActivityLifecycleProjectionCounts,
): OrganizationLifecyclePhaseOutcome => ({
  outcome: projectionTotal(counts) === 0 ? 'no_data' : 'complete',
  evidenceRef: activityClosingEvidenceRef(counts),
})

export const activityReadinessOutcome = (
  counts: ActivityLifecycleProjectionCounts,
): OrganizationLifecyclePhaseOutcome => ({
  outcome: projectionTotal(counts) === 0 ? 'no_data' : 'complete',
  evidenceRef: activityReadinessEvidenceRef(counts),
})

export const activityPurgeOutcome = (
  counts: ActivityLifecycleProjectionCounts,
): OrganizationLifecyclePhaseOutcome => ({
  outcome: projectionTotal(counts) === 0 ? 'no_data' : 'complete',
  evidenceRef: activityPurgeEvidenceRef(counts),
})

/**
 * A legal hold is a real answer that stops the coordinator, so it is raised
 * rather than reported as `complete`. The message is content-free: it names the
 * blocker class and a count, never a reason text, matter or actor.
 */
export const assertNoActiveOperationalHistoryLegalHold = (
  activeHolds: number,
  phase: 'purge_readiness' | 'purge',
): void => {
  if (activeHolds === 0) return
  throw new Error(
    `Activity ${phase} blocked: active_operational_history_legal_holds=${activeHolds}`,
  )
}

/**
 * Closing: stop effects, keep data — and Activity has no effect of its own to
 * stop, which is a result worth stating rather than quietly skipping.
 *
 * Activity is a downstream subscriber. It makes no external call, owns no
 * provider credential and holds no tenant-authored content: every row it writes
 * is a projection of a durable fact another context already committed.
 *
 *   * The manager-facing reads (`getActivityTimelineFn`,
 *     `listRecentActivityFn`) carry the `inbox.use` capability, so the
 *     Organization suspension the closure request committed already denies
 *     them — the surface is unavailable before this phase runs.
 *   * The writers are outbox consumers and the `project-recent-activity` job.
 *     That job is catalogued with capability `none`, so — stated plainly rather
 *     than assumed away — the delayed execution gate's suspension check does
 *     NOT stop it. A pre-closure fact still queued when closure begins can
 *     therefore still be projected.
 *
 * That residue is bounded and safe: the originating contexts stop accepting
 * tenant work at their own Closing, so the backlog can only shrink. Projecting
 * an already-committed fact into an unreachable surface creates no new tenant
 * work and no external effect. It is also exactly why Purge deletes the replay
 * authority as well as the projection — a late fact must not be able to rebuild
 * what Purge erased.
 *
 * What is left for this phase is therefore a read: confirm what is now frozen
 * and answer affirmatively. It deliberately mutates nothing — Closing opens a
 * recoverable window, and the projection must be intact if closure is
 * cancelled.
 */
const prepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> =>
  activityClosingOutcome(await readProjectionCounts(tx, request.organizationId))

/**
 * Purge readiness: read only, and fails closed on a legal hold.
 *
 * An unreleased `operational_action_history_legal_holds` row means somebody
 * has asserted that this tenant's operational record must be preserved. The
 * irreversible boundary destroys the Recent Activity projection of the same
 * work, so it must not be crossed while that assertion stands — and the hold
 * must be released deliberately, by the existing operator command, not
 * side-stepped by a scheduled pass. Any unreleased hold blocks, regardless of
 * the interval it protects: narrowing this to the protected window would let a
 * closure slip through a gap in a hold that was never released.
 */
const verifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const activeHolds = await countActiveLegalHolds(tx, request.organizationId)
  assertNoActiveOperationalHistoryLegalHold(activeHolds, 'purge_readiness')
  return activityReadinessOutcome(await readProjectionCounts(tx, request.organizationId))
}

/**
 * Purge: irreversible, content-free, idempotent.
 *
 * Removed (tenant content):
 *   * `recent_activity_entries` — the Recent Activity feed itself, carrying
 *     actor names, avatar URLs, resource labels and transition payloads.
 *   * `recent_activity_replay_facts` — the projection's reconstruction
 *     authority. Leaving it would let a later recovery pass rebuild exactly
 *     the feed this phase just erased, which is resurrection, not retention.
 *   * `recent_activity_actor_label_redactions` — a short-lived privacy fence
 *     whose only purpose is protecting rows in the two tables above. Once they
 *     are gone it protects nothing, and keeping it would retain per-actor
 *     subject identifiers for a tenant that no longer exists.
 *
 * Deliberately RETAINED, and why each is somebody else's decision to reverse:
 *   * `operational_action_history_records` / `_heads` / `_legal_holds` —
 *     independently required evidence under program bullet 5. Migration 0149's
 *     append-only guards reject DELETE and TRUNCATE, so this is enforced by the
 *     database and not merely by this file; its retention horizon remains
 *     report-only pending counsel.
 *   * `recent_activity_vocabulary_reconciliations` — content-minimal receipts
 *     (codes, counts, a target fingerprint, the authorizing operator and an
 *     evidence reference) proving an operator was authorized to rewrite
 *     historical vocabulary. They carry no row identifier and no payload, and
 *     their governed exit criteria require export/restore and erasure proof
 *     before any contraction.
 *   * `audit_logs` — classified to Activity but written by Identity and Goal,
 *     and named by the lifecycle runbook as the retained privacy-request and
 *     sensitive-data-export trail. Activity does not erase another context's
 *     evidence on its behalf.
 *
 * The legal hold is re-checked here even though readiness already passed: a
 * hold can be placed between the two phases, and the irreversible boundary is
 * the wrong place to trust a stale answer.
 *
 * Idempotent by construction: a replay matches zero rows. In practice the
 * shared store never re-runs it, because the committed receipt replays first.
 *
 * Nothing here drops a table, and no compatibility mirror is removed.
 */
const purge = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const organization = request.organizationId
  assertNoActiveOperationalHistoryLegalHold(
    await countActiveLegalHolds(tx, organization),
    'purge',
  )

  const entries = await tx
    .delete(recentActivityEntries)
    .where(eq(recentActivityEntries.organizationId, organization))
    .returning({ id: recentActivityEntries.id })

  const replayFacts = await tx
    .delete(recentActivityReplayFacts)
    .where(eq(recentActivityReplayFacts.organizationId, organization))
    .returning({ replayKey: recentActivityReplayFacts.replayKey })

  const actorLabelRedactions = await tx
    .delete(recentActivityActorLabelRedactions)
    .where(eq(recentActivityActorLabelRedactions.organizationId, organization))
    .returning({ actorSubjectId: recentActivityActorLabelRedactions.actorSubjectId })

  return activityPurgeOutcome({
    entries: entries.length,
    replayFacts: replayFacts.length,
    actorLabelRedactions: actorLabelRedactions.length,
  })
}

/**
 * Build Activity's lifecycle contributor.
 *
 * Composing this object does NOT make purge reachable: the coordinator refuses
 * to run without all seventeen contributors plus independently reviewed support
 * authorization, and its worker schedule stays quarantined.
 */
export const createActivityOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'activity',
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })
