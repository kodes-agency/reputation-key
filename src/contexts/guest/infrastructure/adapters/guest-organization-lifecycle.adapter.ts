// LIF-01 bullets 4 and 5 — the Guest context's Organization lifecycle
// contribution (LIF-01-T12/T13/T14).
//
// This is a cross-context adapter implementation, so it may import the
// contributor port it implements and nothing else from Identity (see
// src/contexts/CONTEXT.md "Dependency rules" and the port header). Authority
// binding, the advisory lock, the request fingerprint and the append-only
// receipt all live in the shared store.
//
// Guest holds the most sensitive rows in the product, so the reading order for
// a reviewer is: why Closing mutates nothing, then why readiness blocks on
// undelivered corrections, then GUEST_PURGE_PLAN and what it deliberately
// keeps.

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  validateContentFreeEvidenceRef,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import {
  feedback,
  guestContactRequestRevealAudits,
  guestContactRequests,
  guestDestinationActionReceipts,
  guestNetworkPressureRecords,
  guestQualifiedScanReceipts,
  guestQualifiedScans,
  guestResponseExperienceSnapshots,
  guestResponseIntegrityDecisions,
  guestResponseMedia,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
  ratings,
  scanEvents,
} from '#/shared/db/schema/guest.schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
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
 * - `portal_metric_lifetime_aggregates`: the ANONYMOUS lifetime aggregate the
 *   Metric context and every Portal statistic depend on. It is Metric's row
 *   and Metric's receipt. Guest must never edit or delete it, and — see
 *   `verifyPurgeReadiness` — must not scrub the source facts until every
 *   correction has reached it, or the aggregate silently becomes wrong.
 * - `guest_contact_request_purge_checkpoints`: a single global cursor for the
 *   serialized 30-day retention authority. It has no `organization_id` and
 *   holds no tenant content; deleting it would corrupt an unrelated running
 *   sweep.
 * - `portals`, `portal_publication_snapshots`, `properties`, Staff
 *   participants: other owners' rows that Guest only references.
 * - `user` rows: a person who submitted nothing here and may be a member of
 *   another Organization. Identity owns identities.
 *
 * `ratings`, `feedback` and `scan_events` ARE in the plan, as ROW deletes.
 * They are physical-drop-blocked compatibility mirrors: the rows are guest
 * content and must go, the tables must not. Nothing in this plan is ever a
 * DROP or a TRUNCATE.
 */
export const GUEST_PURGE_PLAN = Object.freeze([
  'guest_contact_request_reveal_audits',
  'guest_contact_requests',
  'guest_response_private_feedback',
  'guest_response_media',
  'guest_response_session_bindings',
  'guest_response_experience_snapshots',
  'guest_response_integrity_decisions',
  'guest_destination_action_receipts',
  'guest_responses',
  'guest_qualified_scan_receipts',
  'guest_qualified_scans',
  'guest_network_pressure_records',
  'feedback',
  'ratings',
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
    // The roots of the plan plus the three compatibility mirrors, which have
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
          SELECT COUNT(*)::int FROM ${guestQualifiedScanReceipts}
          WHERE ${guestQualifiedScanReceipts.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${guestDestinationActionReceipts}
          WHERE ${guestDestinationActionReceipts.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${guestNetworkPressureRecords}
          WHERE ${guestNetworkPressureRecords.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${ratings}
          WHERE ${ratings.organizationId} = ${organizationId}
        )
        + (
          SELECT COUNT(*)::int FROM ${feedback}
          WHERE ${feedback.organizationId} = ${organizationId}
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
    await tx
      .delete(guestResponseMedia)
      .where(eq(guestResponseMedia.organizationId, organizationId))
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
      .delete(guestDestinationActionReceipts)
      .where(eq(guestDestinationActionReceipts.organizationId, organizationId))
    await tx
      .delete(guestResponses)
      .where(eq(guestResponses.organizationId, organizationId))
    await tx
      .delete(guestQualifiedScanReceipts)
      .where(eq(guestQualifiedScanReceipts.organizationId, organizationId))
    await tx
      .delete(guestQualifiedScans)
      .where(eq(guestQualifiedScans.organizationId, organizationId))
    await tx
      .delete(guestNetworkPressureRecords)
      .where(eq(guestNetworkPressureRecords.organizationId, organizationId))
    // Compatibility mirrors: rows are deleted, the tables are never dropped.
    // `feedback` carries guest-authored comment text and goes before the
    // `ratings` row it references.
    await tx.delete(feedback).where(eq(feedback.organizationId, organizationId))
    await tx.delete(ratings).where(eq(ratings.organizationId, organizationId))
    await tx.delete(scanEvents).where(eq(scanEvents.organizationId, organizationId))
  },
})

function evidenceRef(
  phase: 'closing' | 'purge_readiness' | 'purge',
  outcome: 'complete' | 'no_data',
  request: OrganizationLifecycleContributionRequest,
): string {
  // Identifiers, enums and a revision only. No rating, feedback text, contact
  // value, session pseudonym or count reaches the receipt.
  return validateContentFreeEvidenceRef(
    `guest:${phase}:${outcome}:${request.closureLineageId}:r${request.lifecycleRevision}`,
  )
}

export const GUEST_PURGE_READINESS_BLOCKED =
  'guest purge readiness blocked: Guest facts are not yet delivered to their aggregates'

export const createGuestOrganizationLifecycleContributor = (
  db: Database,
  workbench: GuestLifecycleWorkbench = drizzleGuestLifecycleWorkbench,
) => {
  /**
   * Closing — STOP EFFECTS, KEEP DATA. Guest mutates nothing here.
   *
   * That is a decision, not an omission. Guest has no admission of its own:
   * EVERY public Guest write — scan, rating, correction, private feedback,
   * withdrawal, destination action — re-resolves the Portal by its address
   * token on each request, and that resolution requires both a live Portal
   * publication activation and `isPropertyActive`. Portal withdraws the
   * activation and Property suspends the Property in this same phase, so the
   * Guest write path is already closed by the time this receipt is written.
   *
   * The only alternative would be to edit or expire Guest rows, and Closing is
   * a RECOVERABLE window: every row here is guest content, retained history or
   * a live retention window. Deleting or truncating any of it would make a
   * cancelled closure unrecoverable and would move erasure in front of the
   * irreversible boundary. Guest therefore answers affirmatively and keeps its
   * data intact.
   */
  const prepareClosing = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    const outcome = owned === 0 ? 'no_data' : 'complete'
    return { outcome, evidenceRef: evidenceRef('closing', outcome, request) }
  }

  /**
   * Purge readiness — READ ONLY, and the ordering gate the lifetime aggregate
   * depends on.
   *
   * A Guest correction, withdrawal or scan retraction becomes a correction to
   * the anonymous `portal_metric_lifetime_aggregates` row only once its outbox
   * fact has been published. Scrubbing the source facts while one is still
   * unpublished would strand the correction forever: the aggregate keeps the
   * uncorrected count and the fact that would have fixed it no longer exists.
   * So corrections are applied to the aggregate BEFORE the source facts are
   * scrubbed, and this is where that ordering is enforced.
   *
   * Failing is the only way this contract can say "blocked". It leaves the
   * Organization in `closing` and the next pass retries.
   */
  const verifyPurgeReadiness = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    const undelivered = await workbench.countUndeliveredGuestFacts(
      tx,
      request.organizationId,
    )
    if (undelivered > 0) throw new Error(GUEST_PURGE_READINESS_BLOCKED)
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    const outcome = owned === 0 ? 'no_data' : 'complete'
    return { outcome, evidenceRef: evidenceRef('purge_readiness', outcome, request) }
  }

  /**
   * Purge — IRREVERSIBLE, reached only after readiness passed.
   *
   * Every guest-authored value goes: private feedback bodies, legacy feedback
   * comments, ratings, permitted contact ciphertext, media object keys,
   * session pseudonyms and network pseudonyms. What stays is the anonymous
   * lifetime aggregate (Metric's row), the global retention cursor, and this
   * context's own content-free receipt.
   *
   * Idempotent: presence is read first, so a replay over an already-scrubbed
   * Organization deletes nothing and still answers.
   */
  const purge = async (
    tx: Tx,
    request: OrganizationLifecycleContributionRequest,
  ): Promise<OrganizationLifecyclePhaseOutcome> => {
    const owned = await workbench.countTenantRows(tx, request.organizationId)
    if (owned === 0) {
      return { outcome: 'no_data', evidenceRef: evidenceRef('purge', 'no_data', request) }
    }
    await workbench.scrubTenantRows(tx, request.organizationId)
    return { outcome: 'complete', evidenceRef: evidenceRef('purge', 'complete', request) }
  }

  return createOrganizationLifecycleContributorScaffold({
    db,
    context: 'guest',
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })
}
