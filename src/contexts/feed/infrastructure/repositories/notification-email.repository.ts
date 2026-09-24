// Feed notification surface — Drizzle repository adapter for notification email queue
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationDigestBatches,
  notificationEmailQueue,
} from '#/shared/db/schema/notification.schema'
import {
  notificationEmailId,
  organizationId as toOrgId,
  propertyId as toPropertyId,
  userId as toUserId,
  type OrganizationId,
} from '#/shared/domain/ids'
import type {
  DeliveryErrorClass,
  EmailQueueStatus,
  NotificationEmail,
} from '../../domain/notification-types'
import type {
  NotificationEmailRecipient,
  ProviderDeliveryState,
  ProviderStateTransition,
} from '../../application/ports/notification-email-repository.port'
import { createNotificationEmailSuppressionStore } from './notification-email-suppression.repository'
import { createNotificationUnsubscribeScopeStore } from './notification-unsubscribe-scope.repository'
import { createNotificationDigestBatchStore } from './notification-digest-batch.repository'
import { emailFromRow, firstAttemptAt, SENDABLE } from './notification-email-queue-rows'
import { notificationError } from '../../domain/notification-errors'
import { activePropertyCondition } from './active-property'

const scope = (id: string, orgId: string, propertyId: string | null) =>
  and(
    eq(notificationEmailQueue.id, id),
    eq(notificationEmailQueue.organizationId, orgId),
    propertyId === null
      ? isNull(notificationEmailQueue.propertyId)
      : eq(notificationEmailQueue.propertyId, propertyId),
  )

/**
 * "Due" = still sendable, retry budget intact, and both time gates open.
 * Shared by the property-, Organization- and recipient-scoped reads so the
 * digest sweep and the orphan sweep can never disagree about what is due.
 */
const dueForCadence = (cadence: string, now: Date) =>
  and(
    eq(notificationEmailQueue.cadence, cadence),
    or(
      eq(notificationEmailQueue.status, 'pending'),
      eq(notificationEmailQueue.status, 'delayed'),
      and(
        eq(notificationEmailQueue.status, 'failed'),
        and(
          eq(notificationEmailQueue.lastErrorClass, 'transient'),
          sql`${notificationEmailQueue.retryCount} < 5`,
        ),
      ),
    ),
    or(
      sql`${notificationEmailQueue.notBefore} IS NULL`,
      lte(notificationEmailQueue.notBefore, now),
    ),
    or(
      sql`${notificationEmailQueue.nextAttemptAt} IS NULL`,
      lte(notificationEmailQueue.nextAttemptAt, now),
    ),
  )

/**
 * The row's Property is still active. Rows for an archived, suspended or
 * deleted Property are held, not settled: the urgent path holds them the same
 * way (it resolves only active Properties), a restored Property's backlog is
 * retired as stale rather than flushed, and Organization closure cancels them.
 */
const onActiveProperty = sql`EXISTS (
  SELECT 1 FROM properties p
   WHERE p.organization_id = ${notificationEmailQueue.organizationId}
     AND p.id = ${notificationEmailQueue.propertyId}
     AND ${sql.raw(activePropertyCondition('p'))}
)`

/**
 * ADR 0046 r.6 is a state MACHINE, not a last-writer-wins field. Provider
 * webhooks arrive out of order often enough that a late `delivered` would
 * otherwise erase a `bounced` and we would keep mailing a dead address.
 * `delivered` may only advance an accepted row; the negative terminals may
 * also overwrite `delivered`, never each other's row a second time. A failure
 * or suppression only ever follows acceptance: the provider reports either
 * INSTEAD of delivering.
 */
const PROVIDER_STATE_PREDECESSORS: Readonly<
  Record<ProviderDeliveryState, readonly EmailQueueStatus[]>
> = {
  delivered: ['accepted'],
  delivery_delayed: ['accepted'],
  bounced: ['accepted', 'delivered'],
  complained: ['accepted', 'delivered'],
  failed: ['accepted'],
  suppressed: ['accepted'],
}

/**
 * The reason on a row the PROVIDER suppressed. Local suppressions also set
 * `provider_state = 'suppressed'` (a disabled preference, a changed digest), so
 * only this reason says the provider refused the address.
 */
const PROVIDER_SUPPRESSION_REASON = 'provider_suppressed'

/** What a provider event needs to know about each row it concerns. */
const TRANSITION_COLUMNS = {
  id: notificationEmailQueue.id,
  userId: notificationEmailQueue.userId,
  organizationId: notificationEmailQueue.organizationId,
  propertyId: notificationEmailQueue.propertyId,
}

const transitionFromRow = (
  row: Readonly<{
    id: string
    userId: string
    organizationId: string
    propertyId: string | null
  }>,
): ProviderStateTransition => ({
  emailId: notificationEmailId(row.id),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  propertyId: row.propertyId === null ? null : toPropertyId(row.propertyId),
})

/** The columns each provider-reported state writes. */
const providerStateColumns = (state: ProviderDeliveryState, occurredAt: Date) => {
  switch (state) {
    case 'delivered':
      return { status: state, providerState: state, deliveredAt: occurredAt }
    // Still in flight at the provider. The status stays `accepted`: the queue's
    // own `delayed` is the sendable quiet-hours state, and the sweep would mail
    // the message again.
    case 'delivery_delayed':
      return { providerState: state }
    case 'bounced':
    case 'complained':
      return { status: state, providerState: state, bouncedAt: occurredAt }
    // Terminal: an accepted message the provider then failed to send. It is
    // not retried, because the idempotency key would only replay the failure.
    case 'failed':
      return {
        status: state,
        providerState: state,
        lastErrorClass: 'permanent',
        failedAt: occurredAt,
        nextAttemptAt: null,
      }
    case 'suppressed':
      return {
        status: state,
        providerState: state,
        suppressionReason: PROVIDER_SUPPRESSION_REASON,
        nextAttemptAt: null,
      }
  }
}

export type NotificationEmailRepositoryOptions = Readonly<{
  /**
   * The server secret refused addresses are keyed with. Without it the
   * suppression methods throw rather than guess.
   */
  emailAddressKey?: string
}>

export const createNotificationEmailRepository = (
  db: Database,
  options: NotificationEmailRepositoryOptions = {},
) => ({
  ...createNotificationEmailSuppressionStore(db, options.emailAddressKey),
  ...createNotificationUnsubscribeScopeStore(db),
  ...createNotificationDigestBatchStore(db),

  insert: async (email: NotificationEmail): Promise<NotificationEmail> => {
    const rows = await db
      .insert(notificationEmailQueue)
      .values({
        id: email.id as string,
        notificationId: email.notificationId as string,
        userId: email.userId as string,
        organizationId: email.organizationId as string,
        propertyId: email.propertyId as string | null,
        category: email.category,
        cadence: email.cadence,
        status: email.status,
        priority: email.priority,
        idempotencyKey: email.idempotencyKey,
        providerMessageId: email.providerMessageId,
        providerState: email.providerState,
        lastErrorClass: email.lastErrorClass,
        suppressionReason: email.suppressionReason,
        notBefore: email.notBefore,
        nextAttemptAt: email.nextAttemptAt,
        attemptedAt: email.attemptedAt,
        acceptedAt: email.acceptedAt,
        deliveredAt: email.deliveredAt,
        bouncedAt: email.bouncedAt,
        sentAt: email.sentAt,
        failedAt: email.failedAt,
        retryCount: email.retryCount,
        recipientAudience: email.recipientAudience ?? null,
        createdAt: email.createdAt,
        updatedAt: email.updatedAt,
      })
      // Property and Organization scopes use separate partial unique indexes.
      // The row shape determines which one PostgreSQL applies.
      .onConflictDoNothing()
      .returning()
    if (rows[0]) return emailFromRow(rows[0])

    const existing = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, email.organizationId as string),
          email.propertyId === null
            ? isNull(notificationEmailQueue.propertyId)
            : eq(notificationEmailQueue.propertyId, email.propertyId as string),
          eq(notificationEmailQueue.idempotencyKey, email.idempotencyKey),
        ),
      )
      .limit(1)
    if (!existing[0])
      throw notificationError('insert_failed', 'Email queue INSERT returned no row')
    return emailFromRow(existing[0])
  },

  findById: async (
    id: string,
    orgId: string,
    propertyId: string | null,
  ): Promise<NotificationEmail | null> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(scope(id, orgId, propertyId))
      .limit(1)
    return rows[0] ? emailFromRow(rows[0]) : null
  },

  findDueByProperty: async (
    orgId: string,
    propertyId: string,
    cadence: string,
    now: Date,
  ): Promise<NotificationEmail[]> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, orgId),
          eq(notificationEmailQueue.propertyId, propertyId),
          dueForCadence(cadence, now),
        ),
      )
      .orderBy(asc(notificationEmailQueue.createdAt))
      .limit(500)
    return rows.map(emailFromRow)
  },

  findDueOrganizationScopes: async (now: Date): Promise<readonly OrganizationId[]> => {
    const rows = await db
      .selectDistinct({ organizationId: notificationEmailQueue.organizationId })
      .from(notificationEmailQueue)
      .where(
        and(isNull(notificationEmailQueue.propertyId), dueForCadence('immediate', now)),
      )
      .orderBy(asc(notificationEmailQueue.organizationId))
      .limit(5_000)
    return rows.map((row) => toOrgId(row.organizationId))
  },

  findDueByOrganization: async (
    orgId: string,
    now: Date,
  ): Promise<NotificationEmail[]> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, orgId),
          isNull(notificationEmailQueue.propertyId),
          dueForCadence('immediate', now),
        ),
      )
      .orderBy(asc(notificationEmailQueue.createdAt))
      .limit(500)
    return rows.map(emailFromRow)
  },

  findDueRecipients: async (
    cadence: string,
    now: Date,
  ): Promise<readonly NotificationEmailRecipient[]> => {
    const [rows, openBatches] = await Promise.all([
      db
        .selectDistinct({
          organizationId: notificationEmailQueue.organizationId,
          userId: notificationEmailQueue.userId,
        })
        .from(notificationEmailQueue)
        .where(and(dueForCadence(cadence, now), onActiveProperty))
        .orderBy(
          asc(notificationEmailQueue.organizationId),
          asc(notificationEmailQueue.userId),
        )
        .limit(5_000),
      cadence === 'daily'
        ? db
            .selectDistinct({
              organizationId: notificationDigestBatches.organizationId,
              userId: notificationDigestBatches.userId,
            })
            .from(notificationDigestBatches)
            .where(inArray(notificationDigestBatches.state, ['prepared', 'retryable']))
            .orderBy(
              asc(notificationDigestBatches.organizationId),
              asc(notificationDigestBatches.userId),
            )
            .limit(5_000)
        : Promise.resolve([]),
    ])
    const recipients = new Map<string, NotificationEmailRecipient>()
    // Recover already-owned provider attempts before opening new work when a
    // large backlog reaches the sweep cap.
    for (const row of [...openBatches, ...rows]) {
      recipients.set(`${row.organizationId}\0${row.userId}`, {
        organizationId: toOrgId(row.organizationId),
        userId: toUserId(row.userId),
      })
    }
    return [...recipients.values()].slice(0, 5_000)
  },

  findDueByUser: async (
    orgId: string,
    userId: string,
    cadence: string,
    now: Date,
  ): Promise<NotificationEmail[]> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, orgId),
          eq(notificationEmailQueue.userId, userId),
          dueForCadence(cadence, now),
          onActiveProperty,
        ),
      )
      .orderBy(asc(notificationEmailQueue.createdAt))
      .limit(500)
    return rows.map(emailFromRow)
  },

  markAttemptStarted: async (
    id: string,
    orgId: string,
    propertyId: string | null,
    startedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({ attemptedAt: firstAttemptAt(startedAt), updatedAt: startedAt })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
  },

  markAccepted: async (
    id: string,
    orgId: string,
    propertyId: string | null,
    providerMessageId: string,
    acceptedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: 'accepted',
        providerMessageId,
        providerState: 'accepted',
        acceptedAt,
        sentAt: acceptedAt,
        attemptedAt: firstAttemptAt(acceptedAt),
        lastErrorClass: null,
        nextAttemptAt: null,
        updatedAt: acceptedAt,
      })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
  },

  markDelayed: async (
    id: string,
    orgId: string,
    propertyId: string | null,
    notBefore: Date,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({ status: 'delayed', notBefore, updatedAt })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
  },

  markFailed: async (
    id: string,
    orgId: string,
    propertyId: string | null,
    classification: DeliveryErrorClass,
    nextAttemptAt: Date | null,
    failedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: classification === 'suppressed' ? 'suppressed' : 'failed',
        lastErrorClass: classification,
        failedAt,
        attemptedAt: firstAttemptAt(failedAt),
        nextAttemptAt,
        retryCount: sql`${notificationEmailQueue.retryCount} + 1`,
        updatedAt: failedAt,
      })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
  },

  markSuppressed: async (
    id: string,
    orgId: string,
    propertyId: string | null,
    reason: string,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: 'suppressed',
        providerState: 'suppressed',
        suppressionReason: reason,
        updatedAt,
      })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
  },

  /**
   * ADR 0046 r.6. Returns the rows it actually moved so the caller can cascade
   * a bounce onto the recipient's other queued mail; an empty array means the
   * event was unknown or out of order, which the webhook logs rather than
   * silently discards.
   */
  recordProviderState: async (
    providerMessageId: string,
    state: ProviderDeliveryState,
    occurredAt: Date,
  ): Promise<readonly ProviderStateTransition[]> => {
    const rows = await db
      .update(notificationEmailQueue)
      .set({ ...providerStateColumns(state, occurredAt), updatedAt: occurredAt })
      .where(
        and(
          eq(notificationEmailQueue.providerMessageId, providerMessageId),
          inArray(notificationEmailQueue.status, [...PROVIDER_STATE_PREDECESSORS[state]]),
        ),
      )
      .returning(TRANSITION_COLUMNS)
    return rows.map(transitionFromRow)
  },

  findProviderMessageRecipients: async (
    providerMessageId: string,
  ): Promise<readonly ProviderStateTransition[]> => {
    const rows = await db
      .select(TRANSITION_COLUMNS)
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.providerMessageId, providerMessageId))
    return rows.map(transitionFromRow)
  },

  /**
   * A dead address stays dead: once the provider reports a bounce or a
   * complaint, every still-sendable row this recipient has in the org is
   * suppressed rather than left to be attempted and rejected one by one.
   */
  /**
   * The work these notices asked for is done, so the mail behind them has
   * nothing left to announce. `cancelled` is terminal (ADR 0046 r.6); only a
   * still-sendable row is moved, so a row the provider may already have
   * accepted is left exactly as it stands.
   */
  cancelQueuedForNotifications: async (
    notificationIds: ReadonlyArray<string>,
    orgId: string,
    reason: string,
    updatedAt: Date,
  ): Promise<number> => {
    if (notificationIds.length === 0) return 0
    const rows = await db
      .update(notificationEmailQueue)
      .set({
        status: 'cancelled',
        suppressionReason: reason,
        nextAttemptAt: null,
        updatedAt,
      })
      .where(
        and(
          eq(notificationEmailQueue.organizationId, orgId),
          inArray(notificationEmailQueue.notificationId, [...notificationIds]),
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
      .returning({ id: notificationEmailQueue.id })
    return rows.length
  },

  suppressRecipient: async (
    userId: string,
    orgId: string,
    reason: string,
    updatedAt: Date,
  ): Promise<number> => {
    const rows = await db
      .update(notificationEmailQueue)
      .set({
        status: 'suppressed',
        providerState: 'suppressed',
        suppressionReason: reason,
        nextAttemptAt: null,
        updatedAt,
      })
      .where(
        and(
          eq(notificationEmailQueue.userId, userId),
          eq(notificationEmailQueue.organizationId, orgId),
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
      .returning({ id: notificationEmailQueue.id })
    return rows.length
  },
})
