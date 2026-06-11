// Notification context — Drizzle repository adapter for notification email queue
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq, asc, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notificationEmailQueue } from '#/shared/db/schema/notification.schema'
import {
  notificationId,
  notificationEmailId,
  userId as toUserId,
  organizationId as toOrgId,
} from '#/shared/domain/ids'
import type {
  NotificationEmail,
  NotificationPriority,
  EmailQueueStatus,
} from '../../domain/types'
import { notificationError } from '../../domain/errors'

// ── Row → Domain mapper ─────────────────────────────────────────────

type EmailRow = typeof notificationEmailQueue.$inferSelect

const emailFromRow = (row: EmailRow): NotificationEmail => ({
  id: notificationEmailId(row.id),
  notificationId: notificationId(row.notificationId),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  status: row.status as EmailQueueStatus,
  priority: row.priority as NotificationPriority,
  sentAt: row.sentAt,
  failedAt: row.failedAt,
  retryCount: row.retryCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

// ── Repository ──────────────────────────────────────────────────────

export const createNotificationEmailRepository = (db: Database) => ({
  insert: async (email: NotificationEmail): Promise<NotificationEmail> => {
    const row = await db
      .insert(notificationEmailQueue)
      .values({
        id: email.id as string,
        notificationId: email.notificationId as string,
        userId: email.userId as string,
        organizationId: email.organizationId as string,
        status: email.status,
        priority: email.priority,
        sentAt: email.sentAt,
        failedAt: email.failedAt,
        retryCount: email.retryCount,
        createdAt: email.createdAt,
        updatedAt: email.updatedAt,
      })
      .onConflictDoUpdate({
        target: [notificationEmailQueue.notificationId],
        set: {
          priority: email.priority,
          updatedAt: email.updatedAt,
        },
      })
      .returning()

    const r = row[0]
    if (!r)
      throw notificationError(
        'insert_failed',
        'No row returned from notification email INSERT',
      )
    return emailFromRow(r)
  },

  findById: async (id: string, orgId: string): Promise<NotificationEmail | null> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.id, id),
          eq(notificationEmailQueue.organizationId, orgId),
        ),
      )
      .limit(1)
    return rows[0] ? emailFromRow(rows[0]) : null
  },

  findPendingByOrg: async (
    orgId: string,
    priority: string,
  ): Promise<NotificationEmail[]> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, orgId),
          eq(notificationEmailQueue.status, 'pending'),
          eq(notificationEmailQueue.priority, priority),
        ),
      )
      .orderBy(asc(notificationEmailQueue.createdAt))

    return rows.map(emailFromRow)
  },

  // ⚠️ CROSS-TENANT by design — global email worker
  findPendingUrgent: async (): Promise<NotificationEmail[]> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.status, 'pending'),
          eq(notificationEmailQueue.priority, 'urgent'),
        ),
      )
      .orderBy(asc(notificationEmailQueue.createdAt))
      .limit(1000)
    return rows.map(emailFromRow)
  },

  markSent: async (
    id: string,
    orgId: string,
    sentAt: Date,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({ status: 'sent', sentAt, updatedAt })
      .where(
        and(
          eq(notificationEmailQueue.id, id),
          eq(notificationEmailQueue.organizationId, orgId),
          inArray(notificationEmailQueue.status, ['pending', 'failed']),
        ),
      )
  },

  markFailed: async (
    id: string,
    orgId: string,
    failedAt: Date,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: 'failed',
        failedAt,
        retryCount: sql`${notificationEmailQueue.retryCount} + 1`,
        updatedAt,
      })
      .where(
        and(
          eq(notificationEmailQueue.id, id),
          eq(notificationEmailQueue.organizationId, orgId),
          inArray(notificationEmailQueue.status, ['pending', 'failed']),
        ),
      )
  },

  markSkipped: async (id: string, orgId: string, updatedAt: Date): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({ status: 'skipped', updatedAt })
      .where(
        and(
          eq(notificationEmailQueue.id, id),
          eq(notificationEmailQueue.organizationId, orgId),
          eq(notificationEmailQueue.status, 'pending'),
        ),
      )
  },
})
