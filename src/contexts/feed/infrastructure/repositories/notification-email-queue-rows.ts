// Feed notification surface — the email queue's row mapping and the
// predicates every queue write shares, used by the queue repository and the
// digest batch store alike.

import { sql } from 'drizzle-orm'
import { notificationEmailQueue } from '#/shared/db/schema/notification.schema'
import {
  notificationEmailId,
  notificationId,
  organizationId as toOrgId,
  propertyId as toPropertyId,
  userId as toUserId,
} from '#/shared/domain/ids'
import type {
  DeliveryErrorClass,
  EmailQueueStatus,
  NotificationCadence,
  NotificationCategory,
  NotificationEmail,
  NotificationPriority,
} from '../../domain/notification-types'

type EmailRow = typeof notificationEmailQueue.$inferSelect

export const emailFromRow = (row: EmailRow): NotificationEmail => ({
  id: notificationEmailId(row.id),
  notificationId: notificationId(row.notificationId),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  propertyId: row.propertyId === null ? null : toPropertyId(row.propertyId),
  category: row.category as NotificationCategory,
  cadence: row.cadence as NotificationCadence,
  status: row.status as EmailQueueStatus,
  priority: row.priority as NotificationPriority,
  idempotencyKey: row.idempotencyKey,
  providerMessageId: row.providerMessageId,
  providerState: row.providerState,
  lastErrorClass: row.lastErrorClass as DeliveryErrorClass | null,
  suppressionReason: row.suppressionReason,
  notBefore: row.notBefore,
  nextAttemptAt: row.nextAttemptAt,
  attemptedAt: row.attemptedAt,
  acceptedAt: row.acceptedAt,
  deliveredAt: row.deliveredAt,
  bouncedAt: row.bouncedAt,
  sentAt: row.sentAt,
  failedAt: row.failedAt,
  retryCount: row.retryCount,
  recipientAudience: row.recipientAudience ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

/** Statuses a row can still be sent from. */
export const SENDABLE: readonly EmailQueueStatus[] = ['pending', 'failed', 'delayed']

/**
 * `attempted_at` holds a row's FIRST provider attempt: the provider's 24-hour
 * idempotency window opens there, so later attempts never move it.
 */
export const firstAttemptAt = (at: Date) =>
  sql`COALESCE(${notificationEmailQueue.attemptedAt}, ${at})`
