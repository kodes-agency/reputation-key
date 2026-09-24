// Feed notification surface — Drizzle repository adapter for notification preferences
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationCategoryDefaults,
  notificationPreferences,
  notificationPropertyDeliveryWindows,
  notificationUserSettings,
} from '#/shared/db/schema/notification.schema'
import {
  notificationPreferenceId,
  organizationId as toOrgId,
  propertyId as toPropertyId,
  userId as toUserId,
} from '#/shared/domain/ids'
import type {
  ConfigurableNotificationCategory,
  NotificationCadence,
  NotificationCategory,
  NotificationCategoryDefault,
  NotificationChannel,
  NotificationPreference,
  NotificationPropertyDeliveryWindow,
  NotificationUserSettings,
  PersonalDeliveryWindow,
} from '../../domain/notification-types'
import {
  resolveCategoryPreference,
  resolveDeliveryWindow,
  type CategoryPreferenceValues,
} from '../../domain/notification-preference-resolution'
import { notificationError } from '../../domain/notification-errors'
import { isPreferenceDisableable } from '../../domain/notification-policy'

type PreferenceRow = typeof notificationPreferences.$inferSelect
type CategoryDefaultRow = typeof notificationCategoryDefaults.$inferSelect
type DeliveryWindowRow = typeof notificationPropertyDeliveryWindows.$inferSelect
type UserSettingsRow = typeof notificationUserSettings.$inferSelect

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const categoryDefaultFromRow = (row: CategoryDefaultRow): NotificationCategoryDefault => {
  const category = row.category as ConfigurableNotificationCategory
  const channel = row.channel as NotificationChannel
  return {
    userId: toUserId(row.userId),
    organizationId: toOrgId(row.organizationId),
    category,
    channel,
    enabled: isPreferenceDisableable(category, channel) ? row.enabled : true,
    cadence: row.cadence as NotificationCadence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * `time` columns read back as `HH:mm:ss`; every surface and the delivery
 * policy speak `HH:mm`. A window stored with equal times is read as no window
 * at all, which is how delivery has always treated it — the CHECK refuses new
 * ones, and an older row must not make an otherwise valid save fail.
 */
const windowFromRow = (
  row: Readonly<{
    quietHoursStart: string | null
    quietHoursEnd: string | null
    urgentBypassEnabled: boolean
  }>,
): PersonalDeliveryWindow => {
  const start = row.quietHoursStart?.slice(0, 5) ?? null
  const end = row.quietHoursEnd?.slice(0, 5) ?? null
  const real = start !== null && start !== end
  return {
    quietHoursStart: real ? start : null,
    quietHoursEnd: real ? end : null,
    urgentBypassEnabled: row.urgentBypassEnabled,
  }
}

const propertyWindowFromRow = (
  row: DeliveryWindowRow,
): NotificationPropertyDeliveryWindow => ({
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  propertyId: toPropertyId(row.propertyId),
  ...windowFromRow(row),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const userSettingsFromRow = (row: UserSettingsRow): NotificationUserSettings => ({
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  locale: row.locale,
  timezone: row.timezone,
  ...windowFromRow(row),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const refuseMandatory = (category: NotificationCategory): void => {
  if (category === 'mandatory') {
    throw notificationError(
      'invalid_input',
      'Mandatory notifications cannot be configured',
    )
  }
}

export const createNotificationPreferenceRepository = (db: Database) => {
  /**
   * The one settings row a person holds in an Organization. Two readers want
   * different parts of it — the delivery window and the whole settings record —
   * and both must agree on which row that is.
   */
  const userSettingsRow = async (userId: string, orgId: string) => {
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
    return rows[0] ?? null
  }

  const scopedPreference = async (
    userId: string,
    orgId: string,
    propertyId: string,
    category: string,
    channel: string,
  ): Promise<CategoryPreferenceValues | null> => {
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
    if (!rows[0]) return null
    const preference = preferenceFromRow(rows[0])
    return { enabled: preference.enabled, cadence: preference.cadence }
  }

  const categoryDefault = async (
    userId: string,
    orgId: string,
    category: string,
    channel: string,
  ): Promise<CategoryPreferenceValues | null> => {
    const rows = await db
      .select()
      .from(notificationCategoryDefaults)
      .where(
        and(
          eq(notificationCategoryDefaults.userId, userId),
          eq(notificationCategoryDefaults.organizationId, orgId),
          eq(notificationCategoryDefaults.category, category),
          eq(notificationCategoryDefaults.channel, channel),
        ),
      )
      .limit(1)
    if (!rows[0]) return null
    const stored = categoryDefaultFromRow(rows[0])
    return { enabled: stored.enabled, cadence: stored.cadence }
  }

  const personalWindow = async (
    userId: string,
    orgId: string,
  ): Promise<PersonalDeliveryWindow | null> => {
    const row = await userSettingsRow(userId, orgId)
    return row ? windowFromRow(row) : null
  }

  const propertyWindow = async (
    userId: string,
    orgId: string,
    propertyId: string,
  ): Promise<PersonalDeliveryWindow | null> => {
    const rows = await db
      .select()
      .from(notificationPropertyDeliveryWindows)
      .where(
        and(
          eq(notificationPropertyDeliveryWindows.userId, userId),
          eq(notificationPropertyDeliveryWindows.organizationId, orgId),
          eq(notificationPropertyDeliveryWindows.propertyId, propertyId),
        ),
      )
      .limit(1)
    return rows[0] ? windowFromRow(rows[0]) : null
  }

  const writePreference = async (
    preference: NotificationPreference,
    set: Readonly<{ enabled: boolean; cadence?: NotificationCadence; updatedAt: Date }>,
  ): Promise<NotificationPreference> => {
    refuseMandatory(preference.category)
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
        set,
      })
      .returning()
    if (!rows[0])
      throw notificationError('insert_failed', 'Preference UPSERT returned no row')
    return preferenceFromRow(rows[0])
  }

  return {
    resolveForDelivery: async (
      userId: string,
      orgId: string,
      propertyId: string,
      category: string,
      channel: string,
    ): Promise<CategoryPreferenceValues> => {
      const [property, personalDefault] = await Promise.all([
        scopedPreference(userId, orgId, propertyId, category, channel),
        categoryDefault(userId, orgId, category, channel),
      ])
      return resolveCategoryPreference({
        category: category as NotificationCategory,
        channel: channel as NotificationChannel,
        property,
        personalDefault,
      })
    },

    resolveDeliveryWindow: async (
      userId: string,
      orgId: string,
      propertyId: string | null,
    ): Promise<PersonalDeliveryWindow> => {
      const [personal, override] = await Promise.all([
        personalWindow(userId, orgId),
        propertyId === null
          ? Promise.resolve(null)
          : propertyWindow(userId, orgId, propertyId),
      ])
      return resolveDeliveryWindow(personal, override)
    },

    upsert: (preference: NotificationPreference) =>
      writePreference(preference, {
        enabled: preference.enabled,
        cadence: preference.cadence,
        updatedAt: preference.updatedAt,
      }),

    /**
     * Semantic category mute: insert governed defaults when no row exists, but
     * on conflict change only the enabled flag. An existing cadence must
     * survive a mute action taken from the notification feed.
     */
    upsertEnabled: (preference: NotificationPreference) =>
      writePreference(preference, {
        enabled: preference.enabled,
        updatedAt: preference.updatedAt,
      }),

    applyCategoryDefaultEverywhere: async (
      categoryDefaultRow: NotificationCategoryDefault,
    ): Promise<NotificationCategoryDefault> => {
      refuseMandatory(categoryDefaultRow.category)
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(notificationCategoryDefaults)
          .values({
            userId: categoryDefaultRow.userId as string,
            organizationId: categoryDefaultRow.organizationId as string,
            category: categoryDefaultRow.category,
            channel: categoryDefaultRow.channel,
            enabled: categoryDefaultRow.enabled,
            cadence: categoryDefaultRow.cadence,
            createdAt: categoryDefaultRow.createdAt,
            updatedAt: categoryDefaultRow.updatedAt,
          })
          .onConflictDoUpdate({
            target: [
              notificationCategoryDefaults.userId,
              notificationCategoryDefaults.organizationId,
              notificationCategoryDefaults.category,
              notificationCategoryDefaults.channel,
            ],
            set: {
              enabled: categoryDefaultRow.enabled,
              cadence: categoryDefaultRow.cadence,
              updatedAt: categoryDefaultRow.updatedAt,
            },
          })
          .returning()
        // "Apply to all my properties" means all of them, including the ones
        // configured differently — a per-Property row left behind would keep
        // overriding the answer the person just gave for every Property.
        await tx
          .delete(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.userId, categoryDefaultRow.userId as string),
              eq(
                notificationPreferences.organizationId,
                categoryDefaultRow.organizationId as string,
              ),
              eq(notificationPreferences.category, categoryDefaultRow.category),
              eq(notificationPreferences.channel, categoryDefaultRow.channel),
            ),
          )
        if (!rows[0]) {
          throw notificationError(
            'insert_failed',
            'Category default UPSERT returned no row',
          )
        }
        return categoryDefaultFromRow(rows[0])
      })
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

    findCategoryDefaults: async (
      userId: string,
      orgId: string,
    ): Promise<NotificationCategoryDefault[]> => {
      const rows = await db
        .select()
        .from(notificationCategoryDefaults)
        .where(
          and(
            eq(notificationCategoryDefaults.userId, userId),
            eq(notificationCategoryDefaults.organizationId, orgId),
          ),
        )
      return rows.map(categoryDefaultFromRow)
    },

    findPropertyDeliveryWindows: async (
      userId: string,
      orgId: string,
    ): Promise<NotificationPropertyDeliveryWindow[]> => {
      const rows = await db
        .select()
        .from(notificationPropertyDeliveryWindows)
        .where(
          and(
            eq(notificationPropertyDeliveryWindows.userId, userId),
            eq(notificationPropertyDeliveryWindows.organizationId, orgId),
          ),
        )
      return rows.map(propertyWindowFromRow)
    },

    upsertPropertyDeliveryWindow: async (
      window: NotificationPropertyDeliveryWindow,
    ): Promise<NotificationPropertyDeliveryWindow> => {
      const rows = await db
        .insert(notificationPropertyDeliveryWindows)
        .values({
          userId: window.userId as string,
          organizationId: window.organizationId as string,
          propertyId: window.propertyId as string,
          quietHoursStart: window.quietHoursStart,
          quietHoursEnd: window.quietHoursEnd,
          urgentBypassEnabled: window.urgentBypassEnabled,
          createdAt: window.createdAt,
          updatedAt: window.updatedAt,
        })
        .onConflictDoUpdate({
          target: [
            notificationPropertyDeliveryWindows.userId,
            notificationPropertyDeliveryWindows.organizationId,
            notificationPropertyDeliveryWindows.propertyId,
          ],
          set: {
            quietHoursStart: window.quietHoursStart,
            quietHoursEnd: window.quietHoursEnd,
            urgentBypassEnabled: window.urgentBypassEnabled,
            updatedAt: window.updatedAt,
          },
        })
        .returning()
      const row = rows[0]
      if (!row) {
        throw notificationError(
          'insert_failed',
          'Property delivery window UPSERT returned no row',
        )
      }
      return propertyWindowFromRow(row)
    },

    clearPropertyDeliveryWindow: async (
      userId: string,
      orgId: string,
      propertyId: string,
    ): Promise<void> => {
      await db
        .delete(notificationPropertyDeliveryWindows)
        .where(
          and(
            eq(notificationPropertyDeliveryWindows.userId, userId),
            eq(notificationPropertyDeliveryWindows.organizationId, orgId),
            eq(notificationPropertyDeliveryWindows.propertyId, propertyId),
          ),
        )
    },

    getUserSettings: async (
      userId: string,
      orgId: string,
    ): Promise<NotificationUserSettings | null> => {
      const row = await userSettingsRow(userId, orgId)
      return row ? userSettingsFromRow(row) : null
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
          quietHoursStart: settings.quietHoursStart,
          quietHoursEnd: settings.quietHoursEnd,
          urgentBypassEnabled: settings.urgentBypassEnabled,
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
            quietHoursStart: settings.quietHoursStart,
            quietHoursEnd: settings.quietHoursEnd,
            urgentBypassEnabled: settings.urgentBypassEnabled,
            updatedAt: settings.updatedAt,
          },
        })
        .returning()
      const row = rows[0]
      if (!row)
        throw notificationError('insert_failed', 'User settings UPSERT returned no row')
      return userSettingsFromRow(row)
    },
  }
}
