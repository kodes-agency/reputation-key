import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import { notificationPreferenceId } from '#/shared/domain/ids'
import type { LowRatingThreshold } from '../domain/notification-low-ratings'
import {
  createNotificationCategoryDefault,
  createNotificationPreference,
} from '../domain/constructors-preference'
import type {
  ConfigurableNotificationCategory,
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
} from '../domain/notification-types'
import type { Database } from '#/shared/db'
import * as store from './notification-preferences.server'
import {
  muteNotificationCategory,
  undoNotificationCategoryMute,
  type PreviousPropertySetting,
} from './mute-category.server'

type Dependencies = Readonly<{
  db: Database
  clock: () => Date
  idGen: () => string
}>

/** The writes behind the settings screens and the bell's mute and Undo. */
export const createPreferenceCommands = (input: Dependencies) => {
  const { db } = input
  return {
    updatePreference: async (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
      enabled: boolean,
      cadence: NotificationCadence,
      applyToAllProperties: boolean,
      /** Low ratings only: "N★ or lower". */
      maxRating: LowRatingThreshold | null = null,
    ) => {
      const now = input.clock()
      const result = createNotificationPreference(
        {
          id: notificationPreferenceId(input.idGen()),
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          propertyId: propertyId as PropertyId,
          category,
          channel,
          enabled,
          cadence,
          maxRating,
        },
        () => now,
      )
      if (result.isErr()) throw result.error
      if (!applyToAllProperties) return store.upsert(db, result.value)
      // "Make this my default" is a statement about the person, not one
      // Property: it becomes the default every Property without its own row
      // inherits. Other Properties' own rows stay (D7).
      const categoryDefault = createNotificationCategoryDefault(
        {
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          category: category as ConfigurableNotificationCategory,
          channel,
          enabled,
          cadence,
          maxRating,
        },
        () => now,
      )
      if (categoryDefault.isErr()) throw categoryDefault.error
      await store.saveCategoryDefault(db, categoryDefault.value, propertyId)
      return result.value
    },
    /** Resets one Property's own settings for a category to the person's default. */
    resetPropertyCategory: (
      userId: string,
      orgId: string,
      propertyId: string,
      category: ConfigurableNotificationCategory,
    ) =>
      store.resetPropertyCategory(
        db,
        userId as UserId,
        orgId as OrganizationId,
        propertyId,
        category,
      ),
    mutePreferenceCategory: (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
    ) =>
      muteNotificationCategory(
        {
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          propertyId: propertyId as PropertyId,
          category,
          channel,
        },
        {
          newId: () => notificationPreferenceId(input.idGen()),
          clock: input.clock,
          findPropertyPreference: (...args) => store.findPropertyPreference(db, ...args),
          upsertEnabled: (preference) => store.upsertEnabled(db, preference),
        },
      ),
    /** The bell's Undo for a mute: puts back what the mute replaced. */
    undoMutePreferenceCategory: (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
      previous: PreviousPropertySetting,
    ) =>
      undoNotificationCategoryMute(
        {
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          propertyId: propertyId as PropertyId,
          category,
          channel,
          previous,
        },
        {
          newId: () => notificationPreferenceId(input.idGen()),
          clock: input.clock,
          upsertEnabled: (preference) => store.upsertEnabled(db, preference),
          deletePropertyPreference: (...args) =>
            store.deletePropertyPreference(db, ...args),
        },
      ),
  } as const
}
