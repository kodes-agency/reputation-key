// Inbox's Organization lifecycle contribution (LIF-01 T12/T13/T14).
//
// This is a cross-context adapter: it implements Identity's
// `organization-lifecycle-contributor.port`, which src/contexts/CONTEXT.md
// "Dependency rules" names as the one foreign module an adapter may import.
// Nothing else from Identity is reachable from here.
//
// The three phases are deliberately asymmetric:
//
//   closing  — STOP EFFECTS, KEEP DATA. Closure opens a recoverable window, so
//              nothing is deleted or redacted. Inbox owns exactly one kind of
//              background effect (Response Target reminder slots), and it is
//              cancelled through the reminder's own governed terminal column.
//   readiness— READ ONLY. It answers whether Inbox can be purged and refuses
//              when a reminder is still schedulable, because that would mean a
//              worker could still act on a closed Organization.
//   purge    — IRREVERSIBLE. Handling history is TENANT data, not independently
//              retained evidence, so it goes with the items it describes.
//
// Every phase runs through the shared, transaction-bound receipt store, which
// re-reads the live lifecycle authority under a row lock, serializes concurrent
// first attempts, and co-commits one content-free receipt with the phase work.

import { sql } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  validateContentFreeEvidenceRef,
  type OrganizationLifecyclePhaseOutcome,
  type OrganizationLifecycleContributionRequest,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import { sha256Hex } from '#/shared/domain/sha256'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'

type LifecyclePhase = 'closing' | 'purge_readiness' | 'purge'

/**
 * One content-free step record. `step` is a fixed code from this file and
 * `rows` is a count, so a receipt digest can never carry tenant content.
 */
type PhaseStep = Readonly<{ step: string; rows: number }>

/**
 * Inbox tables that are scoped by `organization_id` and hold tenant content.
 * The presence probe uses this list so `no_data` means "Inbox holds nothing for
 * this Organization", not "this phase happened to change no rows".
 *
 * `inbox_assignment_history`, `inbox_escalation_history`,
 * `inbox_feedback_handling_outcomes`, `inbox_handling_cycle_transitions`,
 * `inbox_handling_cycle_heads`, `inbox_handling_cycle_response_targets` and
 * `inbox_response_target_reminders` are omitted on purpose: each one is a child
 * of a row already probed here, so probing them would only cost extra scans.
 */
const PRESENCE_PROBE_TABLES = Object.freeze([
  'inbox_items',
  'inbox_handling_cycles',
  'inbox_notes',
  'inbox_response_target_organization_policies',
  'inbox_private_feedback_target_property_overrides',
  'inbox_user_views',
] as const)

function phaseEvidenceRef(
  phase: LifecyclePhase,
  request: OrganizationLifecycleContributionRequest,
  steps: readonly PhaseStep[],
): string {
  const digest = sha256Hex(
    canonicalizeRfc8785({
      context: 'inbox',
      phase,
      closureLineageId: request.closureLineageId,
      lifecycleRevision: request.lifecycleRevision,
      steps: steps.map((entry) => ({ step: entry.step, rows: entry.rows })),
    }),
  )
  return validateContentFreeEvidenceRef(
    `inbox-lifecycle:${phase}:${request.closureLineageId}:${request.lifecycleRevision}:${digest.slice(0, 32)}`,
  )
}

async function countAffected(tx: Tx, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(statement)
  return result.rowCount ?? 0
}

/**
 * Reads a single `count(*)::int AS blocked` scalar. A missing or unreadable
 * row is an error rather than a zero: a readiness check that silently counted
 * nothing would report "not blocked" for a query that never ran.
 */
async function countRows(tx: Tx, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(statement)
  const value = Number((result.rows[0] as { blocked?: unknown } | undefined)?.blocked)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('inbox lifecycle readiness count is unreadable')
  }
  return value
}

/** True when Inbox holds at least one row for the Organization. */
async function hasInboxData(tx: Tx, organizationId: string): Promise<boolean> {
  for (const table of PRESENCE_PROBE_TABLES) {
    // `table` comes from the frozen literal list above, never from input.
    const probe = await tx.execute(
      sql`SELECT 1 FROM ${sql.raw(table)} WHERE organization_id = ${organizationId} LIMIT 1`,
    )
    if (probe.rows.length > 0) return true
  }
  return false
}

function outcomeFor(
  hasData: boolean,
  phase: LifecyclePhase,
  request: OrganizationLifecycleContributionRequest,
  steps: readonly PhaseStep[],
): OrganizationLifecyclePhaseOutcome {
  return {
    // `no_data` is affirmative evidence that Inbox held nothing, which is a
    // different claim from "this phase changed nothing".
    outcome: hasData ? 'complete' : 'no_data',
    evidenceRef: phaseEvidenceRef(phase, request, steps),
  }
}

/**
 * Closing stops Inbox's only background effect and touches nothing else.
 *
 * A Response Target reminder is a scheduled slot whose delivery would notify
 * managers about an Organization that is closing. `cancelled_at` is the
 * reminder's own governed terminal column — the database trigger accepts
 * exactly one terminal stamp on an open slot — so the cancellation is
 * idempotent (a second pass matches no rows) and reversible (a cancelled
 * closure re-opens work through the ordinary Response Target path).
 *
 * Nothing is deleted and no manager-authored row is rewritten: items, cycles,
 * notes, assignment/escalation history and outcomes are untouched, because the
 * Organization can still come back.
 */
async function prepareClosing(
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> {
  const cancelledReminders = await countAffected(
    tx,
    sql`UPDATE inbox_response_target_reminders
        SET cancelled_at = ${request.occurredAt},
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${request.organizationId}
          AND delivered_at IS NULL
          AND cancelled_at IS NULL`,
  )
  const hasData = await hasInboxData(tx, request.organizationId)
  return outcomeFor(hasData, 'closing', request, [
    { step: 'response_target_reminders_cancelled', rows: cancelledReminders },
  ])
}

/**
 * Read-only readiness. It issues SELECTs only.
 *
 * The one Inbox condition that must fail closed is a reminder that is still
 * schedulable: it would let the release job act on an Organization that is
 * about to be purged. A blocked readiness throws, which stops the coordinator
 * before the irreversible boundary; reporting `complete` to keep things moving
 * would be a lie.
 */
async function verifyPurgeReadiness(
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> {
  const pendingReminders = await countRows(
    tx,
    sql`SELECT count(*)::int AS blocked
        FROM inbox_response_target_reminders
        WHERE organization_id = ${request.organizationId}
          AND delivered_at IS NULL
          AND cancelled_at IS NULL`,
  )
  if (pendingReminders > 0) {
    throw new Error(
      `inbox purge readiness blocked: unfenced_response_target_reminders=${pendingReminders}`,
    )
  }
  const hasData = await hasInboxData(tx, request.organizationId)
  return outcomeFor(hasData, 'purge_readiness', request, [
    { step: 'unfenced_response_target_reminders', rows: pendingReminders },
  ])
}

/**
 * Irreversible, idempotent scrub of Inbox's tenant content.
 *
 * `inbox_items` is the only row that has to be named. Handling cycles, cycle
 * heads, cycle transitions, Response Targets, reminders, assignment history,
 * escalation history, private-feedback outcomes and notes all hang off it by
 * `ON DELETE CASCADE`, and their PostgreSQL immutability triggers accept a
 * delete ONLY as such a cascade (`pg_trigger_depth() > 1` with the parent
 * already gone). Deleting the parent is therefore the sanctioned erasure path,
 * and it is also why this adapter never disables a trigger or drops a table.
 *
 * Handling history is TENANT data — it is the Organization's own record of how
 * it triaged its reviews and feedback — not independently retained evidence, so
 * it goes with the items. The content-free lifecycle receipts, which live in
 * `context_organization_lifecycle_receipts`, are the evidence that survives.
 *
 * The three remaining statements cover the Inbox rows that are NOT children of
 * an item: the Organization's Response Target policy, its per-Property private
 * feedback overrides, and each member's personal "last opened Inbox" watermark.
 */
async function purge(
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> {
  const hasData = await hasInboxData(tx, request.organizationId)
  const items = await countAffected(
    tx,
    sql`DELETE FROM inbox_items WHERE organization_id = ${request.organizationId}`,
  )
  const organizationPolicies = await countAffected(
    tx,
    sql`DELETE FROM inbox_response_target_organization_policies
        WHERE organization_id = ${request.organizationId}`,
  )
  const propertyOverrides = await countAffected(
    tx,
    sql`DELETE FROM inbox_private_feedback_target_property_overrides
        WHERE organization_id = ${request.organizationId}`,
  )
  const userViews = await countAffected(
    tx,
    sql`DELETE FROM inbox_user_views WHERE organization_id = ${request.organizationId}`,
  )
  return outcomeFor(hasData, 'purge', request, [
    { step: 'items_deleted', rows: items },
    { step: 'organization_policies_deleted', rows: organizationPolicies },
    { step: 'property_overrides_deleted', rows: propertyOverrides },
    { step: 'user_views_deleted', rows: userViews },
  ])
}

/**
 * Build Inbox's lifecycle contributor.
 *
 * The scaffold supplies the authority binding, the advisory transaction lock
 * and the content-free receipt; only the three phase bodies above are
 * Inbox-specific, so a reviewer reads exactly those.
 */
export const createInboxOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'inbox',
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })
