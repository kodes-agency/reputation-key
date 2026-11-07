import {
  isLowRatingThreshold,
  type LowRatingThreshold,
} from '../../domain/notification-low-ratings'
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

/** A stored Low-ratings threshold; anything else, and every other category, is none. */
const maxRatingOf = (value: number | null): LowRatingThreshold | null =>
  isLowRatingThreshold(value) ? value : null

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
    maxRating: maxRatingOf(row.maxRating),
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
    maxRating: maxRatingOf(row.maxRating),
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

const preferenceScope = (
  userId: string,
  orgId: string,
  propertyId: string,
  category: string,
  channel?: string,
) =>
  and(
    eq(notificationPreferences.userId, userId),
    eq(notificationPreferences.organizationId, orgId),
    eq(notificationPreferences.propertyId, propertyId),
    eq(notificationPreferences.category, category),
    channel === undefined ? undefined : eq(notificationPreferences.channel, channel),
  )

const propertyWindowScope = (userId: string, orgId: string, propertyId?: string) =>
  and(
    eq(notificationPropertyDeliveryWindows.userId, userId),
    eq(notificationPropertyDeliveryWindows.organizationId, orgId),
    propertyId === undefined
      ? undefined
      : eq(notificationPropertyDeliveryWindows.propertyId, propertyId),
  )

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
      .where(preferenceScope(userId, orgId, propertyId, category, channel))
      .limit(1)
    if (!rows[0]) return null
    const preference = preferenceFromRow(rows[0])
    return {
      enabled: preference.enabled,
      cadence: preference.cadence,
      maxRating: preference.maxRating,
    }
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
    return {
      enabled: stored.enabled,
      cadence: stored.cadence,
      maxRating: stored.maxRating,
    }
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
      .where(propertyWindowScope(userId, orgId, propertyId))
      .limit(1)
    return rows[0] ? windowFromRow(rows[0]) : null
  }

  const writePreference = async (
    preference: NotificationPreference,
    set: Readonly<{
      enabled: boolean
      cadence?: NotificationCadence
      maxRating?: number | null
      updatedAt: Date
    }>,
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
        maxRating: preference.maxRating ?? null,
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

    /** One Property's own row for a category and channel, or null when it inherits. */
    findPropertyPreference: scopedPreference,

    /**
     * Removes one Property's own row, so it inherits the person's default
     * again: how a mute taken from the bell is undone when that Property had
     * no row of its own before it.
     */
    deletePropertyPreference: async (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
    ): Promise<void> => {
      refuseMandatory(category)
      await db
        .delete(notificationPreferences)
        .where(preferenceScope(userId, orgId, propertyId, category, channel))
    },

    upsert: (preference: NotificationPreference) =>
      writePreference(preference, {
        enabled: preference.enabled,
        cadence: preference.cadence,
        maxRating: preference.maxRating ?? null,
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

    /**
     * One Property's own settings for a category, both channels, removed: it
     * follows the person's default again. The explicit reset an exception
     * waits for (D7).
     */
    resetPropertyCategory: async (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
    ): Promise<void> => {
      refuseMandatory(category)
      await db
        .delete(notificationPreferences)
        .where(preferenceScope(userId, orgId, propertyId, category))
    },

    saveCategoryDefault: async (
      categoryDefaultRow: NotificationCategoryDefault,
      followingPropertyId: string,
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
            maxRating: categoryDefaultRow.maxRating ?? null,
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
              maxRating: categoryDefaultRow.maxRating ?? null,
              updatedAt: categoryDefaultRow.updatedAt,
            },
          })
          .returning()
        // The Property the answer was given at follows it now, so its own row
        // goes. Every other Property's own row stays until explicitly reset.
        await tx
          .delete(notificationPreferences)
          .where(
            preferenceScope(
              categoryDefaultRow.userId,
              categoryDefaultRow.organizationId,
              followingPropertyId,
              categoryDefaultRow.category,
              categoryDefaultRow.channel,
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
        .where(propertyWindowScope(userId, orgId))
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
        .where(propertyWindowScope(userId, orgId, propertyId))
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
