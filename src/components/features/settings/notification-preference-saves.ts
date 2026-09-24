// How one Property/category/channel preference row is saved, and what a
// Property with no row of its own inherits. A save writes the whole row, so
// two quick edits of one row (Email on, then Immediate) must neither be built
// from the same stale snapshot nor land out of order — either way the second
// silently undoes the first.

import {
  effectiveEmailCadence,
  getDefaultCadence,
  getDefaultEnabled,
  type ConfigurableNotificationCategory,
  type NotificationChannel,
  type NotificationPreference,
} from '#/contexts/feed/application/public-api'

/**
 * The two values one preference row holds. Quiet hours and the urgent bypass
 * left it in ADR 0046's 2026-09-23 amendment: they are the person's, saved
 * once for every Property rather than once per (Property, category, channel).
 */
export type PreferenceValues = Pick<NotificationPreference, 'enabled' | 'cadence'>

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
 * category defaults for a row that was never saved.
 */
export function applyPreferencePatch(
  category: ConfigurableNotificationCategory,
  channel: NotificationChannel,
  current: PreferenceValues | undefined,
  patch: PreferencePatch,
): PreferenceValues {
  return {
    enabled: patch.enabled ?? current?.enabled ?? getDefaultEnabled(category, channel),
    // A stored email cadence the category no longer offers (goal email saved
    // as immediate) is sent back as the one it is delivered at, or the server
    // refuses every later change to the row.
    cadence:
      channel === 'email'
        ? effectiveEmailCadence(category, patch.cadence ?? current?.cadence)
        : (patch.cadence ?? current?.cadence ?? getDefaultCadence(category)),
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
