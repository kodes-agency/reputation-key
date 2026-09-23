// Feed notification surface — the daily digest's open batch: which of its
// frozen members may still go out, and how it closes when they cannot all.
//
// A batch freezes its members and its provider idempotency key, and a retry
// must never send different mail under that key. When a member drops — the
// recipient lost a Property, a preference was switched off, the row was
// settled elsewhere — what happens depends on whether the provider may already
// hold the mail:
//
//  * A batch the provider refused on every attempt protects no delivered mail.
//    It is retired and its remaining members go out in a fresh batch under a
//    new key: a digest drops only the rows that fail (Feed CONTEXT.md).
//  * Any other batch may already be in the inbox. Sending the rest under a new
//    key could deliver it twice, so the batch is invalidated as a unit.

import type {
  NotificationDigestBatch,
  NotificationEmailRepositoryPort,
} from '../../application/ports/notification-email-repository.port'
import type { NotificationEmail } from '../../domain/notification-types'
import {
  authorizedEntries,
  partitionDeliverable,
  type DigestEntryDeps,
  type RecipientContext,
} from './digest-entry-selection'

export type FrozenBatchDeps = DigestEntryDeps &
  Readonly<{
    emailRepo: Pick<
      NotificationEmailRepositoryPort,
      'findDigestBatchEntries' | 'settleDigestBatch'
    >
  }>

/** A batch's retry budget; its members' counts move together. */
const MAX_BATCH_ATTEMPTS = 5

const SENDABLE_STATUSES: readonly string[] = ['pending', 'failed', 'delayed']

const isSendableMember = (entry: NotificationEmail): boolean =>
  SENDABLE_STATUSES.includes(entry.status) &&
  !(entry.status === 'failed' && entry.lastErrorClass !== 'transient')

const mustWait = (entry: NotificationEmail, now: Date): boolean =>
  (entry.notBefore !== null && entry.notBefore > now) ||
  (entry.nextAttemptAt !== null && entry.nextAttemptAt > now)

const sameIds = (
  entries: readonly NotificationEmail[],
  expected: readonly NotificationEmail[],
): boolean =>
  entries.length === expected.length &&
  entries.every((entry, index) => entry.id === expected[index]?.id)

export async function invalidateBatch(
  deps: FrozenBatchDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
  reason: string,
): Promise<void> {
  await deps.emailRepo.settleDigestBatch({
    batchId: batch.id,
    organizationId: ctx.orgId,
    userId: ctx.userId,
    expectedContentDigest: batch.contentDigest,
    settlement: { kind: 'invalidated', reason, invalidatedAt: ctx.now },
  })
  deps.logger.warn({ batchId: batch.id, reason }, 'Digest batch invalidated')
}

/**
 * Retire a batch the provider refused on every attempt and free its members.
 * False when another worker changed the batch first.
 */
export async function supersedeBatch(
  deps: FrozenBatchDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
  expectedContentDigest: string,
): Promise<boolean> {
  const superseded = await deps.emailRepo.settleDigestBatch({
    batchId: batch.id,
    organizationId: ctx.orgId,
    userId: ctx.userId,
    expectedContentDigest,
    settlement: { kind: 'superseded', detectedAt: ctx.now },
  })
  if (!superseded) {
    deps.logger.warn(
      { batchId: batch.id },
      'Refused digest batch changed before it could be retired',
    )
  }
  return superseded
}

/** Close an open batch none of whose members can go out any more. */
async function retireOpenBatch(
  deps: FrozenBatchDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
  reason: string,
): Promise<void> {
  if (!batch.everyAttemptRefused) {
    await invalidateBatch(deps, ctx, batch, reason)
    return
  }
  if (await supersedeBatch(deps, ctx, batch, batch.contentDigest)) {
    deps.logger.info(
      { batchId: batch.id, reason },
      'Refused digest batch retired because none of its members can go out',
    )
  }
}

/**
 * Whether a frozen batch goes on after a filter kept `kept` of `before`. A
 * batch the provider may have accepted cannot lose a member: it is
 * invalidated here, and the caller stops.
 */
async function frozenMembershipHolds(
  deps: FrozenBatchDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
  before: readonly NotificationEmail[],
  kept: readonly NotificationEmail[],
  reason: string,
): Promise<boolean> {
  if (batch.everyAttemptRefused || sameIds(kept, before)) return true
  await invalidateBatch(deps, ctx, batch, reason)
  return false
}

/** The members still sendable, or `null` when the batch waits or is closed. */
async function sendableMembers(
  deps: FrozenBatchDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
  members: readonly NotificationEmail[],
): Promise<readonly NotificationEmail[] | null> {
  const sendable = members.filter(isSendableMember)
  const exhausted = members.some((entry) => entry.retryCount >= MAX_BATCH_ATTEMPTS)
  // A spent budget ends any batch; a member settled elsewhere ends one the
  // provider may already hold.
  if (
    members.length === 0 ||
    exhausted ||
    (!batch.everyAttemptRefused && sendable.length !== members.length)
  ) {
    await invalidateBatch(deps, ctx, batch, 'digest_membership_unavailable')
    return null
  }
  return sendable.some((entry) => mustWait(entry, ctx.now)) ? null : sendable
}

/**
 * The frozen members of an open batch this sweep may send, or `null` when
 * there is nothing to send now: the batch must wait, or it was closed here.
 * A frozen batch was fresh when it was prepared, so no freshness bound or
 * 08:00 window applies; it retries on its bounded budget.
 */
export async function selectFrozenEntries(
  deps: FrozenBatchDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
): Promise<readonly NotificationEmail[] | null> {
  const members = await deps.emailRepo.findDigestBatchEntries(
    batch.id,
    ctx.orgId,
    ctx.userId,
  )
  const candidates = await sendableMembers(deps, ctx, batch, members)
  if (candidates === null) return null

  const authorized = await authorizedEntries(deps, ctx.rawOrgId, candidates)
  if (
    !(await frozenMembershipHolds(
      deps,
      ctx,
      batch,
      candidates,
      authorized,
      'digest_authorization_changed',
    ))
  ) {
    return null
  }
  const deliverable = await partitionDeliverable(deps, ctx, authorized)
  if (
    !(await frozenMembershipHolds(
      deps,
      ctx,
      batch,
      authorized,
      deliverable,
      'digest_membership_invalidated',
    ))
  ) {
    return null
  }
  if (deliverable.length === 0) {
    await retireOpenBatch(deps, ctx, batch, 'digest_membership_invalidated')
    return null
  }
  return deliverable
}

/**
 * Close an open batch because the notifications behind its members can no
 * longer be read. Exported for the job, which loads them after selection.
 */
export const retireUnreadableBatch = (
  deps: FrozenBatchDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
): Promise<void> => retireOpenBatch(deps, ctx, batch, 'notification_source_unavailable')
