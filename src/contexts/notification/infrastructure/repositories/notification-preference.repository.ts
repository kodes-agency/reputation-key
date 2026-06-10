// Notification context — Drizzle repository adapter for notification preferences
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notificationPreferences } from '#/shared/db/schema/notification.schema'
import {
  notificationPreferenceId,
  userId as toUserId,
  organizationId as toOrgId,
} from '#/shared/domain/ids'
import type { NotificationPreference, NotificationType } from '../../domain/types'

// ── Row → Domain mapper ─────────────────────────────────────────────

type PreferenceRow = typeof notificationPreferences.$inferSelect

const preferenceFromRow = (row: PreferenceRow): NotificationPreference => ({
  id: notificationPreferenceId(row.id),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  type: row.type as NotificationType,
  emailEnabled: row.emailEnabled,
  inAppEnabled: row.inAppEnabled,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

// ── Repository ──────────────────────────────────────────────────────

export const createNotificationPreferenceRepository = (db: Database) => ({
  findByUserAndType: async (
    userId: string,
    orgId: string,
    type: string,
  ): Promise<NotificationPreference | null> => {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.organizationId, orgId),
          eq(notificationPreferences.type, type),
        ),
      )
      .limit(1)

    return rows[0] ? preferenceFromRow(rows[0]) : null
  },

  upsert: async (preference: NotificationPreference): Promise<NotificationPreference> => {
    const row = await db
      .insert(notificationPreferences)
      .values({
        id: preference.id as string,
        userId: preference.userId as string,
        organizationId: preference.organizationId as string,
        type: preference.type,
        emailEnabled: preference.emailEnabled,
        inAppEnabled: preference.inAppEnabled,
        createdAt: preference.createdAt,
        updatedAt: preference.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.organizationId,
          notificationPreferences.type,
        ],
        set: {
          emailEnabled: preference.emailEnabled,
          inAppEnabled: preference.inAppEnabled,
          updatedAt: preference.updatedAt,
        },
      })
      .returning()

    return preferenceFromRow(row[0]!)
  },

  findByUser: async (
    userId: string,
    orgId: string,
  ): Promise<NotificationPreference[]> => {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.organizationId, orgId),
        ),
      )

    return rows.map(preferenceFromRow)
  },
})
