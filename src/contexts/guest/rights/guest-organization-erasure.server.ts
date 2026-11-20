// Guest's Organization erasure: the purge plan, the count of facts still
// undelivered to their aggregates, and the scrub. The rights executor runs it
// behind its journal entry.

import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  guestContactRequestRevealAudits,
  guestContactRequests,
  guestNetworkPressureRecords,
  guestQualifiedScans,
  guestResponseExperienceSnapshots,
  guestResponseIntegrityDecisions,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
  scanEvents,
} from '#/shared/db/schema/guest.schema'
import { idempotencyReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { Tx } from '#/shared/outbox/commit'

/**
 * Guest-sourced durable facts are relayed to the rest of the system through
 * the outbox. `sourceContext` is derived from the event type prefix, so every
 * Guest fact — including a rating correction, a private-feedback withdrawal
 * and a qualified-scan retraction — carries this value.
 */
const GUEST_OUTBOX_SOURCE_CONTEXT = 'guest'

/**
 * The explicit, static Guest purge plan, innermost dependency first.
 *
 * Deliberately NOT here:
 * - the `guest_contact_purge` idempotency receipt: a single global cursor for
 *   the serialized 30-day retention authority. It has no tenant scope and
 *   holds no tenant content; deleting it would corrupt an unrelated sweep.
 * - `portals`, `portal_publication_snapshots`, `properties`, Staff
 *   participants: other owners' rows that Guest only references.
 * - `user` rows: a person who submitted nothing here and may be a member of
 *   another Organization. Identity owns identities.
 *
 * `scan_events` IS in the plan, as a ROW delete. It is a
 * physical-drop-blocked compatibility mirror: the rows are guest content and
 * must go, the table must not. Nothing in this plan is ever a
 * DROP or a TRUNCATE.
 */
export const GUEST_PURGE_PLAN = Object.freeze([
  'guest_contact_request_reveal_audits',
  'guest_contact_requests',
  'guest_response_private_feedback',
  'guest_response_session_bindings',
  'guest_response_experience_snapshots',
  'guest_response_integrity_decisions',
  'idempotency_receipts',
  'guest_responses',
  'guest_qualified_scans',
  'guest_network_pressure_records',
  'scan_events',
] as const)

export type GuestLifecycleWorkbench = Readonly<{
  /**
   * Readiness: Guest-sourced facts still sitting unpublished in the outbox.
   * READ ONLY.
   */
  countUndeliveredGuestFacts(tx: Tx, organizationId: string): Promise<number>
  /** Presence: does this Organization own any Guest-context row at all? */
  countTenantRows(tx: Tx, organizationId: string): Promise<number>
  /** Purge: irreversible, content-free scrub of the plan above. */
  scrubTenantRows(tx: Tx, organizationId: string): Promise<void>
}>

function count(row: Record<string, unknown> | undefined, key: string): number {
  return Number(row?.[key] ?? 0)
}

export const drizzleGuestLifecycleWorkbench: GuestLifecycleWorkbench = Object.freeze({
  countUndeliveredGuestFacts: async (tx, organizationId) => {
    const undelivered = await tx
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, organizationId),
          eq(outboxEvents.sourceContext, GUEST_OUTBOX_SOURCE_CONTEXT),
          isNull(outboxEvents.publishedAt),
        ),
      )
    return undelivered.length
  },

  countTenantRows: async (tx, organizationId) => {
    // The roots of the plan plus the compatibility mirror, which has
    // no canonical parent and can outlive every `guest_responses` row.
    const result = await tx.execute(sql`
      SELECT
        (
          SELECT COUNT(*)::int FROM ${guestResponses}
          WHERE ${guestResponses.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${guestQualifiedScans}
          WHERE ${guestQualifiedScans.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${idempotencyReceipts}
          WHERE ${idempotencyReceipts.scope} IN ('guest_qualified_scan', 'guest_destination_action')
            AND ${idempotencyReceipts.payload}->>'organizationId' = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${guestNetworkPressureRecords}
          WHERE ${guestNetworkPressureRecords.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${scanEvents}
          WHERE ${scanEvents.organizationId} = ${organizationId}
        ) AS "rows"
    `)
    return count(result.rows[0], 'rows')
  },

  scrubTenantRows: async (tx, organizationId) => {
    // Reveal audits name a contact request, so they go first even though the
    // FK would cascade: an explicit delete keeps the plan and the row counts
    // the integration test asserts in one place.
    await tx
      .delete(guestContactRequestRevealAudits)
      .where(eq(guestContactRequestRevealAudits.organizationId, organizationId))
    // Permitted contact: the ciphertext, the key id and the consent record all
    // go. Contact Request is a dark capability, so in beta this deletes nothing
    // that could lawfully exist — the statement is here so activation cannot
    // later leave contact behind a closed Organization.
    await tx
      .delete(guestContactRequests)
      .where(eq(guestContactRequests.organizationId, organizationId))
    // Guest-authored private text.
    await tx
      .delete(guestResponsePrivateFeedback)
      .where(eq(guestResponsePrivateFeedback.organizationId, organizationId))
    // Session pseudonyms and dedupe receipts.
    await tx
      .delete(guestResponseSessionBindings)
      .where(eq(guestResponseSessionBindings.organizationId, organizationId))
    await tx
      .delete(guestResponseExperienceSnapshots)
      .where(eq(guestResponseExperienceSnapshots.organizationId, organizationId))
    await tx
      .delete(guestResponseIntegrityDecisions)
      .where(eq(guestResponseIntegrityDecisions.organizationId, organizationId))
    await tx
      .delete(idempotencyReceipts)
      .where(
        and(
          sql`${idempotencyReceipts.scope} IN ('guest_qualified_scan', 'guest_destination_action')`,
          sql`${idempotencyReceipts.payload}->>'organizationId' = ${organizationId}`,
        ),
      )
    await tx
      .delete(guestResponses)
      .where(eq(guestResponses.organizationId, organizationId))
    await tx
      .delete(guestQualifiedScans)
      .where(eq(guestQualifiedScans.organizationId, organizationId))
    await tx
      .delete(guestNetworkPressureRecords)
      .where(eq(guestNetworkPressureRecords.organizationId, organizationId))
    // Compatibility mirror: rows are deleted, the table is never dropped.
    await tx.delete(scanEvents).where(eq(scanEvents.organizationId, organizationId))
  },
})

export const GUEST_PURGE_READINESS_BLOCKED =
  'guest purge readiness blocked: Guest facts are not yet delivered to their aggregates'
