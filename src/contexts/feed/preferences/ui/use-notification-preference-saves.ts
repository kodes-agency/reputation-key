import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import type {
  ConfigurableNotificationCategory,
  NotificationCategoryDefault,
  NotificationChannel,
  NotificationPreference,
} from '#/contexts/feed/application/public-api'
import {
  applyPreferencePatch,
  preferenceRowKey,
  type PreferencePatch,
  type PreferenceValues,
} from './notification-preference-saves'
import { applyEverywhereNotice } from './notification-apply-everywhere'
import { actionFailureMessage } from '#/components/hooks/use-action-mutation'
import {
  createNotificationPreferenceWrites,
  type PreferenceReset,
  type PreferenceUpdate,
} from './notification-preference-writes'

export type { PreferenceUpdate } from './notification-preference-writes'

type Options = Readonly<{
  propertyId: string
  preferences: readonly NotificationPreference[]
  /** What a property with no row of its own inherits. */
  categoryDefaults: readonly NotificationCategoryDefault[]
  /** Whether the Property in view may send email; "Apply to all" skips it otherwise. */
  emailAllowed: boolean
  updatePreference: Action<PreferenceUpdate, NotificationPreference>
  resetPropertyCategory: Action<PreferenceReset, void>
}>

type RequestedRows = ReadonlyMap<string, PreferenceValues>

/**
 * Preference saves that cannot undo each other. Each save builds on earlier
 * edits, successful resets and changed defaults, while
 * React may still show the query snapshot from before it. Until a row's last
 * save settles the row shows what was asked for: a switch moves when clicked,
 * and a failed save falls back to the stored row.
 */
export function useNotificationPreferenceSaves({
  propertyId,
  preferences,
  categoryDefaults,
  emailAllowed,
  updatePreference,
  resetPropertyCategory,
}: Options) {
  const [writes] = useState(createNotificationPreferenceWrites)
  const snapshot = { preferences, categoryDefaults }
  const [requested, setRequested] = useState<RequestedRows>(() => new Map())
  // Handlers read the newest request synchronously; state drives the render.
  const latest = useRef<RequestedRows>(requested)
  const commit = (next: RequestedRows) => {
    latest.current = next
    setRequested(next)
  }

  /**
   * This property's own row, else what it inherits from the person's default.
   * Both answer the same question, so the controls show the inherited answer
   * rather than a blank the reader has to guess at.
   */
  const stored = (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
  ): PreferenceValues | undefined =>
    preferences.find(
      (preference) =>
        preference.propertyId === propertyId &&
        preference.category === category &&
        preference.channel === channel,
    ) ??
    categoryDefaults.find((row) => row.category === category && row.channel === channel)

  const preferenceFor = (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
  ): PreferenceValues | undefined =>
    requested.get(preferenceRowKey(propertyId, category, channel)) ??
    stored(category, channel)

  const valuesFor = (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
    patch: PreferencePatch,
  ) =>
    applyPreferencePatch(
      category,
      channel,
      latest.current.get(preferenceRowKey(propertyId, category, channel)) ??
        stored(category, channel),
      patch,
    )

  const savePreference = async (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
    patch: PreferencePatch,
  ): Promise<boolean> => {
    const key = preferenceRowKey(propertyId, category, channel)
    const values = valuesFor(category, channel, patch)
    commit(new Map(latest.current).set(key, values))
    try {
      await writes.save(snapshot, propertyId, category, channel, patch, updatePreference)
      toast.success('Notification preference updated')
      return true
    } catch (error) {
      toast.error(
        actionFailureMessage("Couldn't update that notification preference.")(error),
      )
      return false
    } finally {
      // The row's last request has settled; the refetched row is the truth.
      if (latest.current.get(key) === values) {
        const next = new Map(latest.current)
        next.delete(key)
        commit(next)
      }
    }
  }

  /**
   * The answer at this property becomes the person's default: every property
   * without a setting of its own gets it, including ones they are given next.
   * This property follows it now; other properties' own settings stay (D7).
   */
  const applyToAll = async (category: ConfigurableNotificationCategory) => {
    const outcome = await writes.applyToAll(
      snapshot,
      propertyId,
      category,
      emailAllowed,
      updatePreference,
    )
    const notice = applyEverywhereNotice(outcome)
    if (notice.tone === 'error') toast.error(notice.message)
    else toast.success(notice.message)
  }

  const resetToDefault = async (
    category: ConfigurableNotificationCategory,
    propertyIds: ReadonlyArray<string>,
  ) => {
    const { done, failed } = await writes.reset(
      category,
      propertyIds,
      resetPropertyCategory,
    )
    if (failed) {
      toast.error(
        done === 0
          ? "Couldn't reset to your default. Try again."
          : `${done} of ${propertyIds.length} properties now follow your default; the rest couldn't be reset. Try again.`,
      )
      return
    }
    toast.success(
      propertyIds.length === 1 && propertyIds[0] === propertyId
        ? 'This property now follows your default'
        : `${done} ${done === 1 ? 'property now follows' : 'properties now follow'} your default`,
    )
  }

  return { preferenceFor, savePreference, applyToAll, resetToDefault } as const
}
