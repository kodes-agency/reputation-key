import type {
  ConfigurableNotificationCategory,
  NotificationCategoryDefault,
  NotificationChannel,
  NotificationPreference,
} from '#/contexts/feed/application/public-api'
import {
  applyPreferencePatch,
  createSerialRunner,
  preferenceRequestValues,
  preferenceRowKey,
  type PreferencePatch,
  type PreferenceValues,
} from './notification-preference-saves'
import { applyEverywhereInOrder } from './notification-apply-everywhere'

export type PreferenceUpdate = Readonly<{
  data: Readonly<
    {
      propertyId: string
      category: ConfigurableNotificationCategory
      channel: NotificationChannel
      applyToAllProperties?: boolean
    } & ReturnType<typeof preferenceRequestValues>
  >
}>

export type PreferenceReset = Readonly<{
  data: Readonly<{ propertyId: string; category: ConfigurableNotificationCategory }>
}>

type Snapshot = Readonly<{
  preferences: readonly NotificationPreference[]
  categoryDefaults: readonly NotificationCategoryDefault[]
}>

type PendingCategory = {
  pending: number
  /** Null means a completed reset or default save removed this own setting. */
  rows: Map<string, PreferenceValues | null>
  defaults: Map<NotificationChannel, PreferenceValues>
}

/** Saves, two-channel defaults and multi-Property resets share a category's queue. */
export function createNotificationPreferenceWrites() {
  const runner = createSerialRunner()
  const categories = new Map<ConfigurableNotificationCategory, PendingCategory>()

  const run = <T>(
    category: ConfigurableNotificationCategory,
    task: (current: PendingCategory) => Promise<T>,
  ): Promise<T> => {
    let current = categories.get(category)
    if (!current) {
      current = { pending: 0, rows: new Map(), defaults: new Map() }
      categories.set(category, current)
    }
    const state = current
    state.pending += 1
    return runner
      .run(category, () => task(state))
      .finally(() => {
        state.pending -= 1
        // The next gesture starts from the refetched snapshot. Queued gestures
        // retain earlier edits and completed resets before React renders it.
        if (state.pending === 0) categories.delete(category)
      })
  }

  const valuesFor = (
    current: PendingCategory,
    snapshot: Snapshot,
    propertyId: string,
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
  ): PreferenceValues | undefined => {
    const key = preferenceRowKey(propertyId, category, channel)
    const own = current.rows.has(key)
      ? current.rows.get(key)
      : snapshot.preferences.find(
          (row) =>
            row.propertyId === propertyId &&
            row.category === category &&
            row.channel === channel,
        )
    return (
      own ??
      current.defaults.get(channel) ??
      snapshot.categoryDefaults.find(
        (row) => row.category === category && row.channel === channel,
      )
    )
  }

  const save = async (
    current: PendingCategory,
    snapshot: Snapshot,
    propertyId: string,
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
    patch: PreferencePatch,
    update: (input: PreferenceUpdate) => Promise<NotificationPreference>,
    applyToAllProperties = false,
  ) => {
    const values = applyPreferencePatch(
      category,
      channel,
      valuesFor(current, snapshot, propertyId, category, channel),
      patch,
    )
    const key = preferenceRowKey(propertyId, category, channel)
    // A later edit still asks for the earlier edit's values if its request
    // failed. A successful reset below replaces that intent with inheritance.
    current.rows.set(key, values)
    const saved = await update({
      data: {
        propertyId,
        category,
        channel,
        ...(applyToAllProperties ? { applyToAllProperties: true } : {}),
        ...preferenceRequestValues(values),
      },
    })
    current.rows.set(key, applyToAllProperties ? null : saved)
    if (applyToAllProperties) current.defaults.set(channel, saved)
    return saved
  }

  return {
    save(
      snapshot: Snapshot,
      propertyId: string,
      category: ConfigurableNotificationCategory,
      channel: NotificationChannel,
      patch: PreferencePatch,
      update: (input: PreferenceUpdate) => Promise<NotificationPreference>,
    ) {
      return run(category, (current) =>
        save(current, snapshot, propertyId, category, channel, patch, update),
      )
    },
    applyToAll(
      snapshot: Snapshot,
      propertyId: string,
      category: ConfigurableNotificationCategory,
      emailAllowed: boolean,
      update: (input: PreferenceUpdate) => Promise<NotificationPreference>,
    ) {
      return run(category, (current) =>
        applyEverywhereInOrder(emailAllowed, (channel) =>
          save(current, snapshot, propertyId, category, channel, {}, update, true),
        ),
      )
    },
    reset(
      category: ConfigurableNotificationCategory,
      propertyIds: readonly string[],
      reset: (input: PreferenceReset) => Promise<void>,
    ) {
      return run(category, async (current) => {
        let done = 0
        for (const propertyId of propertyIds) {
          try {
            await reset({ data: { propertyId, category } })
          } catch {
            return { done, failed: true }
          }
          for (const channel of ['in_app', 'email'] as const) {
            current.rows.set(preferenceRowKey(propertyId, category, channel), null)
          }
          done += 1
        }
        return { done, failed: false }
      })
    },
  }
}
