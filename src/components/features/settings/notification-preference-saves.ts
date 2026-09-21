// How one Property/category/channel preference row is saved. A save writes the
// whole row, so two quick edits of one row (Email on, then Immediate) must
// neither be built from the same stale snapshot nor land out of order —
// either way the second silently undoes the first.

import {
  getDefaultCadence,
  getDefaultEnabled,
  type ConfigurableNotificationCategory,
  type NotificationChannel,
  type NotificationPreference,
} from '#/contexts/feed/application/public-api'

/** The five values one preference row holds. */
export type PreferenceValues = Pick<
  NotificationPreference,
  'enabled' | 'cadence' | 'urgentBypassEnabled' | 'quietHoursStart' | 'quietHoursEnd'
>

export type PreferencePatch = Partial<PreferenceValues>

/** One row per (Property, category, channel). */
export function preferenceRowKey(
  propertyId: string,
  category: ConfigurableNotificationCategory,
  channel: NotificationChannel,
): string {
  return `${propertyId}:${category}:${channel}`
}

/**
 * The whole row a save writes: the patch over the current values, and the
 * category defaults for a row that was never saved. `null` quiet hours in the
 * patch clear them; an absent key keeps them.
 */
export function applyPreferencePatch(
  category: ConfigurableNotificationCategory,
  channel: NotificationChannel,
  current: PreferenceValues | undefined,
  patch: PreferencePatch,
): PreferenceValues {
  return {
    enabled: patch.enabled ?? current?.enabled ?? getDefaultEnabled(category, channel),
    cadence: patch.cadence ?? current?.cadence ?? getDefaultCadence(category),
    urgentBypassEnabled:
      patch.urgentBypassEnabled ?? current?.urgentBypassEnabled ?? false,
    quietHoursStart:
      patch.quietHoursStart !== undefined
        ? patch.quietHoursStart
        : (current?.quietHoursStart ?? null),
    quietHoursEnd:
      patch.quietHoursEnd !== undefined
        ? patch.quietHoursEnd
        : (current?.quietHoursEnd ?? null),
  }
}

/**
 * Runs each key's tasks one after another, in call order. A failed task does
 * not stop the next one, and different keys never wait for each other.
 */
export function createSerialRunner() {
  let tails: ReadonlyMap<string, Promise<unknown>> = new Map()
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      const result = previous.then(task, task)
      tails = new Map(tails).set(
        key,
        result.catch(() => undefined),
      )
      return result
    },
  }
}
