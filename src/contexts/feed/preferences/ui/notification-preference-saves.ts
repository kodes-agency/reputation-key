// How one Property/category/channel preference row is saved, and what a
// Property with no row of its own inherits. A save writes the whole row, so
// two quick edits of one row (Email on, then Immediate) must neither be built
// from the same stale snapshot nor land out of order — either way the second
// silently undoes the first.

import {
  effectiveEmailCadence,
  getDefaultCadence,
  getDefaultEnabled,
  getDefaultMaxRating,
  type ConfigurableNotificationCategory,
  type NotificationCategoryDefault,
  type NotificationChannel,
  type NotificationPreference,
} from '#/contexts/feed/public-api'

/**
 * Category switches and cadence are per Property. Quiet hours and the urgent
 * bypass belong to the personal delivery window and its Property overrides.
 */
export type PreferenceValues = Pick<NotificationPreference, 'enabled' | 'cadence'> &
  Readonly<{
    /** Low ratings only: "N★ or lower". */
    maxRating?: NotificationPreference['maxRating']
  }>

export type PreferencePatch = Partial<PreferenceValues>

/** One row per (Property, category, channel). */
export function preferenceRowKey(
  propertyId: string,
  category: ConfigurableNotificationCategory,
  channel: NotificationChannel,
): string {
  return `${propertyId}:${category}:${channel}`
}

/** The Property's own stored row for a category and channel, if it has one. */
export const findOwnPreference = (
  preferences: readonly NotificationPreference[],
  propertyId: string,
  category: ConfigurableNotificationCategory,
  channel: NotificationChannel,
) =>
  preferences.find(
    (row) =>
      row.propertyId === propertyId &&
      row.category === category &&
      row.channel === channel,
  )

/** The person's default for a category and channel, if they set one. */
export const findCategoryDefault = (
  defaults: readonly NotificationCategoryDefault[],
  category: ConfigurableNotificationCategory,
  channel: NotificationChannel,
) => defaults.find((row) => row.category === category && row.channel === channel)

/**
 * The whole row a save writes: the patch over the current values, and the
 * category defaults for a row that was never saved.
 */
export function applyPreferencePatch(
  category: ConfigurableNotificationCategory,
  channel: NotificationChannel,
  current: PreferenceValues | undefined,
  patch: PreferencePatch,
): PreferenceValues {
  // Low ratings cannot be saved without its threshold, so every save of its
  // row carries one: the patch's, the row's, or the default.
  const maxRating =
    patch.maxRating ?? current?.maxRating ?? getDefaultMaxRating(category, channel)
  return {
    enabled: patch.enabled ?? current?.enabled ?? getDefaultEnabled(category, channel),
    // A stored email cadence the category no longer offers (goal email saved
    // as immediate) is sent back as the one it is delivered at, or the server
    // refuses every later change to the row.
    cadence:
      channel === 'email'
        ? effectiveEmailCadence(category, patch.cadence ?? current?.cadence)
        : (patch.cadence ?? current?.cadence ?? getDefaultCadence(category)),
    ...(maxRating === null ? {} : { maxRating }),
  }
}

/** What a save sends for a row: its values, a Low-ratings threshold only when it has one. */
export function preferenceRequestValues(values: PreferenceValues) {
  return {
    enabled: values.enabled,
    cadence: values.cadence,
    ...(values.maxRating ? { maxRating: values.maxRating } : {}),
  }
}

/**
 * Runs each key's tasks one after another, in call order. A failed task does
 * not stop the next one, and different keys never wait for each other.
 */
export function createSerialRunner() {
  const tails = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      const result = previous.then(task, task)
      tails.set(
        key,
        result.catch(() => undefined),
      )
      return result
    },
  }
}
