// Notification context — Drizzle repository adapter for notification preferences
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationPreferences,
  notificationUserSettings,
} from '#/shared/db/schema/notification.schema'
import {
  notificationPreferenceId,
  organizationId as toOrgId,
  propertyId as toPropertyId,
  userId as toUserId,
} from '#/shared/domain/ids'
import type {
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
  NotificationPreference,
  NotificationUserSettings,
} from '../../domain/types'
import { notificationError } from '../../domain/errors'
import { isPreferenceDisableable } from '../../domain/notification-policy'

type PreferenceRow = typeof notificationPreferences.$inferSelect

const preferenceFromRow = (row: PreferenceRow): NotificationPreference => {
  const category = row.category as NotificationCategory
  const channel = row.channel as NotificationChannel
  return {
    id: notificationPreferenceId(row.id),
    userId: toUserId(row.userId),
    organizationId: toOrgId(row.organizationId),
    propertyId: toPropertyId(row.propertyId),
    category,
    channel,
    // Expand-phase compatibility: stale false rows cannot make a required
    // channel appear disabled while the backfill/constraint rolls out.
    enabled: isPreferenceDisableable(category, channel) ? row.enabled : true,
    cadence: row.cadence as NotificationCadence,
    urgentBypassEnabled: row.urgentBypassEnabled,
    quietHoursStart: row.quietHoursStart?.slice(0, 5) ?? null,
    quietHoursEnd: row.quietHoursEnd?.slice(0, 5) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const createNotificationPreferenceRepository = (db: Database) => ({
  findForDelivery: async (
    userId: string,
    orgId: string,
    propertyId: string,
    category: string,
    channel: string,
  ): Promise<NotificationPreference | null> => {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.organizationId, orgId),
          eq(notificationPreferences.propertyId, propertyId),
          eq(notificationPreferences.category, category),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1)
    return rows[0] ? preferenceFromRow(rows[0]) : null
  },

  upsert: async (preference: NotificationPreference): Promise<NotificationPreference> => {
    if (preference.category === 'mandatory') {
      throw notificationError(
        'invalid_input',
        'Mandatory notifications cannot be configured',
      )
    }
    const rows = await db
      .insert(notificationPreferences)
      .values({
        id: preference.id as string,
        userId: preference.userId as string,
        organizationId: preference.organizationId as string,
        propertyId: preference.propertyId as string,
        category: preference.category,
        channel: preference.channel,
        enabled: preference.enabled,
        cadence: preference.cadence,
        urgentBypassEnabled: preference.urgentBypassEnabled,
        quietHoursStart: preference.quietHoursStart,
        quietHoursEnd: preference.quietHoursEnd,
        createdAt: preference.createdAt,
        updatedAt: preference.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.organizationId,
          notificationPreferences.propertyId,
          notificationPreferences.category,
          notificationPreferences.channel,
        ],
        set: {
          enabled: preference.enabled,
          cadence: preference.cadence,
          urgentBypassEnabled: preference.urgentBypassEnabled,
          quietHoursStart: preference.quietHoursStart,
          quietHoursEnd: preference.quietHoursEnd,
          updatedAt: preference.updatedAt,
        },
      })
      .returning()
    if (!rows[0])
      throw notificationError('insert_failed', 'Preference UPSERT returned no row')
    return preferenceFromRow(rows[0])
  },

  /**
   * Semantic category mute: insert governed defaults when no row exists, but
   * on conflict change only the enabled flag. Existing cadence, urgent bypass,
   * and quiet hours must survive a mute action from the notification feed.
   */
  upsertEnabled: async (
    preference: NotificationPreference,
  ): Promise<NotificationPreference> => {
    if (preference.category === 'mandatory') {
      throw notificationError(
        'invalid_input',
        'Mandatory notifications cannot be configured',
      )
    }
    const rows = await db
      .insert(notificationPreferences)
      .values({
        id: preference.id as string,
        userId: preference.userId as string,
        organizationId: preference.organizationId as string,
        propertyId: preference.propertyId as string,
        category: preference.category,
        channel: preference.channel,
        enabled: preference.enabled,
        cadence: preference.cadence,
        urgentBypassEnabled: preference.urgentBypassEnabled,
        quietHoursStart: preference.quietHoursStart,
        quietHoursEnd: preference.quietHoursEnd,
        createdAt: preference.createdAt,
        updatedAt: preference.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.organizationId,
          notificationPreferences.propertyId,
          notificationPreferences.category,
          notificationPreferences.channel,
        ],
        set: {
          enabled: preference.enabled,
          updatedAt: preference.updatedAt,
        },
      })
      .returning()
    if (!rows[0]) {
      throw notificationError('insert_failed', 'Preference mute UPSERT returned no row')
    }
    return preferenceFromRow(rows[0])
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

  getUserSettings: async (
    userId: string,
    orgId: string,
  ): Promise<NotificationUserSettings | null> => {
    const rows = await db
      .select()
      .from(notificationUserSettings)
      .where(
        and(
          eq(notificationUserSettings.userId, userId),
          eq(notificationUserSettings.organizationId, orgId),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row
      ? {
          userId: toUserId(row.userId),
          organizationId: toOrgId(row.organizationId),
          locale: row.locale,
          timezone: row.timezone,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      : null
  },

  upsertUserSettings: async (
    settings: NotificationUserSettings,
  ): Promise<NotificationUserSettings> => {
    const rows = await db
      .insert(notificationUserSettings)
      .values({
        userId: settings.userId as string,
        organizationId: settings.organizationId as string,
        locale: settings.locale,
        timezone: settings.timezone,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          notificationUserSettings.userId,
          notificationUserSettings.organizationId,
        ],
        set: {
          locale: settings.locale,
          timezone: settings.timezone,
          updatedAt: settings.updatedAt,
        },
      })
      .returning()
    const row = rows[0]
    if (!row)
      throw notificationError('insert_failed', 'User settings UPSERT returned no row')
    return {
      userId: toUserId(row.userId),
      organizationId: toOrgId(row.organizationId),
      locale: row.locale,
      timezone: row.timezone,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  },
})
