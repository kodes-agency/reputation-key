// Notification's Organization lifecycle contribution (LIF-01 T12/T13/T14).
//
// Notification carries the highest-risk external effect in the whole closure:
// a delivered email is not recallable, so an email that leaves after the
// Organization is closed is a visible breach of the closed state. Everything
// below is organised around that one fact.
//
// Phase contract, restated for this context:
//   * Closing STOPS DELIVERY and KEEPS DATA. It cancels every still-sendable
//     queued email and terminalises every open provider digest batch. It
//     deletes nothing, because Closing opens a recoverable window.
//   * Purge readiness is READ ONLY. It verifies the Closing fence still holds
//     and refuses (throws) when it does not, which leaves the coordinator's
//     lifecycle state untouched.
//   * Purge is irreversible and only reachable after readiness passed. It is
//     an idempotent, content-free scrub of Notification's tenant rows. It
//     drops no table and removes no compatibility mirror.
//
// The transaction, advisory lock, authority binding, fingerprint and
// content-free receipt all come from the shared receipt store; this file only
// supplies the three reviewed phase bodies.

import { and, count, eq, inArray, ne, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  validateContentFreeEvidenceRef,
  type OrganizationLifecycleContributionRequest,
  type OrganizationLifecyclePhaseOutcome,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import {
  notificationDigestBatchMembers,
  notificationDigestBatches,
  notificationEmailQueue,
  notificationPreferences,
  notificationUserSettings,
  notifications,
} from '#/shared/db/schema/notification.schema'
import type { Tx } from '#/shared/outbox/commit'
// Cross-context adapter contract: src/contexts/CONTEXT.md "Dependency rules"
// lets a foreign infrastructure/adapters/** module import the Identity port it
// implements, and nothing else from Identity.
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'

/**
 * Statuses a queued email can still be sent from.
 *
 * This mirrors `SENDABLE` in `notification-email.repository.ts` and the
 * `dueForCadence` predicate the digest/orphan sweeps share. Moving a row OUT of
 * this set is exactly what makes it undeliverable: every `mark*` write, every
 * due-work query and `batchReadiness` all gate on these three statuses.
 */
const SENDABLE_EMAIL_STATUSES = ['pending', 'failed', 'delayed'] as const

/** Digest batch states that still own a live provider idempotency key. */
const OPEN_DIGEST_BATCH_STATES = ['prepared', 'retryable'] as const

/**
 * The single content-free reason stamped on everything Closing fences.
 *
 * It is a stable code, not prose: it is what a reactivation would target to
 * reverse this fence, and what an operator greps for to distinguish a closure
 * fence from a preference suppression or a provider rejection.
 */
export const NOTIFICATION_CLOSING_FENCE_REASON = 'organization_closing'

export type NotificationLifecycleClosingCounts = Readonly<{
  cancelledEmails: number
  closedDigestBatches: number
}>

export type NotificationLifecycleReadinessCounts = Readonly<{
  sendableEmails: number
  openDigestBatches: number
  retainedRows: number
}>

export type NotificationLifecyclePurgeCounts = Readonly<{
  notifications: number
  emails: number
  digestBatches: number
  digestBatchMembers: number
  preferences: number
  userSettings: number
}>

const total = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0)

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
  if (!where) throw new Error('Notification lifecycle count requires a bound scope')
  const rows = await tx.select({ value: count() }).from(table).where(where)
  return rows[0]?.value ?? 0
}

/**
 * Evidence references carry identifiers, enums and counts only — never a
 * recipient, subject, body or provider message id. Each is validated against
 * the same content-free grammar the receipt column enforces, so a malformed
 * reference fails here rather than at the database check constraint.
 */
export const notificationClosingEvidenceRef = (
  counts: NotificationLifecycleClosingCounts,
): string =>
  validateContentFreeEvidenceRef(
    `notification:closing:mail-${counts.cancelledEmails}:batch-${counts.closedDigestBatches}`,
  )

export const notificationReadinessEvidenceRef = (
  counts: NotificationLifecycleReadinessCounts,
): string =>
  validateContentFreeEvidenceRef(
    `notification:purge_readiness:row-${counts.retainedRows}`,
  )

export const notificationPurgeEvidenceRef = (
  counts: NotificationLifecyclePurgeCounts,
): string =>
  validateContentFreeEvidenceRef(
    [
      'notification:purge',
      `notif-${counts.notifications}`,
      `mail-${counts.emails}`,
      `batch-${counts.digestBatches}`,
      `member-${counts.digestBatchMembers}`,
      `pref-${counts.preferences}`,
      `setting-${counts.userSettings}`,
    ].join(':'),
  )

/**
 * `no_data` is an affirmative answer, not an omission: a context that had
 * nothing to fence or nothing to scrub still returns a receipt, because a
 * missing contributor would make a partial purge look complete.
 */
export const notificationClosingOutcome = (
  counts: NotificationLifecycleClosingCounts,
): OrganizationLifecyclePhaseOutcome => ({
  outcome:
    counts.cancelledEmails + counts.closedDigestBatches === 0 ? 'no_data' : 'complete',
  evidenceRef: notificationClosingEvidenceRef(counts),
})

export const notificationReadinessOutcome = (
  counts: NotificationLifecycleReadinessCounts,
): OrganizationLifecyclePhaseOutcome => ({
  outcome: counts.retainedRows === 0 ? 'no_data' : 'complete',
  evidenceRef: notificationReadinessEvidenceRef(counts),
})

export const notificationPurgeOutcome = (
  counts: NotificationLifecyclePurgeCounts,
): OrganizationLifecyclePhaseOutcome => ({
  outcome:
    total([
      counts.notifications,
      counts.emails,
      counts.digestBatches,
      counts.digestBatchMembers,
      counts.preferences,
      counts.userSettings,
    ]) === 0
      ? 'no_data'
      : 'complete',
  evidenceRef: notificationPurgeEvidenceRef(counts),
})

/**
 * A blocked readiness is a real answer that stops the coordinator, so it is
 * raised rather than reported as `complete`. The message is content-free: it
 * names blocker classes and counts, never a recipient or a message.
 */
export const assertNotificationPurgeReady = (
  counts: NotificationLifecycleReadinessCounts,
): void => {
  if (counts.sendableEmails === 0 && counts.openDigestBatches === 0) return
  throw new Error(
    'Notification purge readiness blocked: ' +
      `sendable_email_queue_rows=${counts.sendableEmails},` +
      `open_digest_batches=${counts.openDigestBatches}`,
  )
}

/**
 * Closing: stop delivery, keep everything.
 *
 * Two writes, both idempotent because both are predicated on the state they
 * leave: a replay matches zero rows and reports zero.
 *
 * 1. Every still-sendable NON-mandatory queued email becomes `cancelled`. That
 *    single status change removes the row from `dueForCadence`, from every
 *    `mark*` guard and from `batchReadiness`, so no sweep can pick it up again.
 *    Mandatory account/security notices are deliberately left alone: they are
 *    Identity's channel for telling the affected people what is happening to
 *    their access, and closure must not silence that during the recoverable
 *    window. Purge removes them with the rest of the queue, so none can survive
 *    the irreversible boundary either way.
 * 2. Every open digest batch is terminalised. Cancelling its members already
 *    makes the next sweep invalidate it, but that depends on a worker pass that
 *    is currently quarantined; closing the batch here makes the fence complete
 *    inside this one transaction and releases its provider idempotency key.
 *
 * Nothing is deleted and no preference is rewritten: closure is cancellable,
 * and a cancelled closure must find the tenant's own settings untouched.
 *
 * This fence is the SECOND of two independent stops, not the only one. Both
 * provider-effecting jobs — `urgent-email` and `digest-notification` — are
 * catalogued with the `notification.send_email` capability, which the
 * Organization suspension committed by the closure request already denies with
 * `org_suspended`. `insert-notification` carries capability `none`, so a queue
 * row can still be WRITTEN behind the fence; it can no longer be SENT, and
 * purge readiness deliberately fails closed if one appears.
 */
const prepareClosing = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const cancelledEmails = await tx
    .update(notificationEmailQueue)
    .set({
      status: 'cancelled',
      suppressionReason: NOTIFICATION_CLOSING_FENCE_REASON,
      notBefore: null,
      nextAttemptAt: null,
      updatedAt: request.occurredAt,
    })
    .where(
      and(
        eq(notificationEmailQueue.organizationId, request.organizationId),
        inArray(notificationEmailQueue.status, [...SENDABLE_EMAIL_STATUSES]),
        ne(notificationEmailQueue.category, 'mandatory'),
      ),
    )
    .returning({ id: notificationEmailQueue.id })

  const closedDigestBatches = await tx
    .update(notificationDigestBatches)
    .set({
      state: 'terminal',
      outcomeClass: 'invalidated',
      terminalReason: NOTIFICATION_CLOSING_FENCE_REASON,
      failedAt: request.occurredAt,
      updatedAt: request.occurredAt,
    })
    .where(
      and(
        eq(notificationDigestBatches.organizationId, request.organizationId),
        inArray(notificationDigestBatches.state, [...OPEN_DIGEST_BATCH_STATES]),
      ),
    )
    .returning({ id: notificationDigestBatches.id })

  return notificationClosingOutcome({
    cancelledEmails: cancelledEmails.length,
    closedDigestBatches: closedDigestBatches.length,
  })
}

/**
 * Purge readiness: read only.
 *
 * It re-asks the exact question Closing answered — can anything still leave
 * this system for this tenant? — and refuses when the answer is yes. It
 * deliberately measures the same two blocker classes Closing fenced, so a
 * failure here means the fence was reverted, or `insert-notification` (which
 * carries capability `none`) queued new product mail behind it. Either way the
 * irreversible boundary must not be crossed until an operator resolves it;
 * blocking forever is the safe direction, silently purging is not.
 *
 * Mandatory account/security notices are excluded from the blocker count for
 * the same reason Closing left them alone — they are Identity's channel while
 * the closure is still recoverable, and Purge removes the whole queue anyway,
 * so none can survive the boundary.
 *
 * The retained row count only classifies the receipt outcome; it never blocks.
 */
const verifyPurgeReadiness = async (
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> => {
  const organization = request.organizationId
  const sendableEmails = await countRows(
    tx,
    notificationEmailQueue,
    and(
      eq(notificationEmailQueue.organizationId, organization),
      inArray(notificationEmailQueue.status, [...SENDABLE_EMAIL_STATUSES]),
      ne(notificationEmailQueue.category, 'mandatory'),
    ),
  )
  const openDigestBatches = await countRows(
    tx,
    notificationDigestBatches,
    and(
      eq(notificationDigestBatches.organizationId, organization),
      inArray(notificationDigestBatches.state, [...OPEN_DIGEST_BATCH_STATES]),
    ),
  )

  const retainedRows = total([
    await countRows(tx, notifications, eq(notifications.organizationId, organization)),
    await countRows(
      tx,
      notificationEmailQueue,
      eq(notificationEmailQueue.organizationId, organization),
    ),
    await countRows(
      tx,
      notificationDigestBatches,
      eq(notificationDigestBatches.organizationId, organization),
    ),
    await countRows(
      tx,
      notificationPreferences,
      eq(notificationPreferences.organizationId, organization),
    ),
    await countRows(
      tx,
      notificationUserSettings,
      eq(notificationUserSettings.organizationId, organization),
    ),
  ])

  const counts = { sendableEmails, openDigestBatches, retainedRows }
  assertNotificationPurgeReady(counts)
  return notificationReadinessOutcome(counts)
}

/**
 * Purge: irreversible, content-free, idempotent.
 *
 * Every table this context owns in `data-fate-authority.ts` is scrubbed by
 * organization scope. Deletion order runs children before parents so a
 * cascade can never silently absorb a row this receipt claims to have counted:
 *
 *   * `notification_digest_batch_members` — batch composition; cascades from
 *     both batches and queue rows, so it is removed first and counted honestly.
 *   * `notification_digest_batches` — provider idempotency keys and content
 *     digests for this tenant's email attempts.
 *   * `notification_email_queue` — the send queue, including provider message
 *     ids and acceptance timestamps.
 *   * `notifications` — the Bell feed, whose title/body/payload are the actual
 *     tenant content this phase exists to erase.
 *   * `notification_preferences` / `notification_user_settings` — the tenant's
 *     own delivery policy, locale and timezone.
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

  const digestBatchMembers = await tx
    .delete(notificationDigestBatchMembers)
    .where(eq(notificationDigestBatchMembers.organizationId, organization))
    .returning({ batchId: notificationDigestBatchMembers.batchId })

  const digestBatches = await tx
    .delete(notificationDigestBatches)
    .where(eq(notificationDigestBatches.organizationId, organization))
    .returning({ id: notificationDigestBatches.id })

  const emails = await tx
    .delete(notificationEmailQueue)
    .where(eq(notificationEmailQueue.organizationId, organization))
    .returning({ id: notificationEmailQueue.id })

  const notificationRows = await tx
    .delete(notifications)
    .where(eq(notifications.organizationId, organization))
    .returning({ id: notifications.id })

  const preferences = await tx
    .delete(notificationPreferences)
    .where(eq(notificationPreferences.organizationId, organization))
    .returning({ id: notificationPreferences.id })

  const userSettings = await tx
    .delete(notificationUserSettings)
    .where(eq(notificationUserSettings.organizationId, organization))
    .returning({ id: notificationUserSettings.id })


  return notificationPurgeOutcome({
    notifications: notificationRows.length,
    emails: emails.length,
    digestBatches: digestBatches.length,
    digestBatchMembers: digestBatchMembers.length,
    preferences: preferences.length,
    userSettings: userSettings.length,
  })
}

/**
 * Build Notification's lifecycle contributor.
 *
 * Composing this object does NOT make purge reachable: the coordinator refuses
 * to run without all seventeen contributors plus independently reviewed support
 * authorization, and its worker schedule stays quarantined.
 */
export const createNotificationOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'notification',
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })
