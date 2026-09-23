import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import type {
  ConfigurableNotificationCategory,
  NotificationChannel,
  NotificationPreference,
} from '#/contexts/feed/application/public-api'
import {
  applyPreferencePatch,
  createSerialRunner,
  preferenceRowKey,
  type PreferencePatch,
  type PreferenceValues,
} from './notification-preference-saves'

export type PreferenceUpdate = Readonly<{
  data: Readonly<
    {
      propertyId: string
      category: ConfigurableNotificationCategory
      channel: NotificationChannel
    } & PreferenceValues
  >
}>

type Options = Readonly<{
  propertyId: string
  preferences: readonly NotificationPreference[]
  updatePreference: Action<PreferenceUpdate, NotificationPreference>
}>

type RequestedRows = ReadonlyMap<string, PreferenceValues>

/**
 * Preference saves that cannot undo each other. Each save is built on what the
 * previous request for its row asked for — not on the query snapshot, which
 * stays stale until the refetch lands — and a row's saves run one after
 * another, so they also land in order. Until a row's last save settles the row
 * shows what was asked for: a switch moves when it is clicked, not a round
 * trip later, and a failed save falls back to the stored row.
 */
export function useNotificationPreferenceSaves({
  propertyId,
  preferences,
  updatePreference,
}: Options) {
  const [runner] = useState(createSerialRunner)
  const [requested, setRequested] = useState<RequestedRows>(() => new Map())
  // Handlers read the newest request synchronously; state drives the render.
  const latest = useRef<RequestedRows>(requested)
  const commit = (next: RequestedRows) => {
    latest.current = next
    setRequested(next)
  }

  const stored = (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
  ): PreferenceValues | undefined =>
    preferences.find(
      (preference) =>
        preference.propertyId === propertyId &&
        preference.category === category &&
        preference.channel === channel,
    )

  const preferenceFor = (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
  ): PreferenceValues | undefined =>
    requested.get(preferenceRowKey(propertyId, category, channel)) ??
    stored(category, channel)

  const savePreference = async (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
    patch: PreferencePatch,
  ) => {
    const key = preferenceRowKey(propertyId, category, channel)
    const current = latest.current.get(key) ?? stored(category, channel)
    const values = applyPreferencePatch(category, channel, current, patch)
    commit(new Map(latest.current).set(key, values))
    try {
      await runner.run(key, () =>
        updatePreference({ data: { propertyId, category, channel, ...values } }),
      )
      toast.success('Notification preference updated')
    } catch {
      toast.error('Could not update notification preference')
    } finally {
      // The row's last request has settled; the refetched row is the truth.
      if (latest.current.get(key) === values) {
        const next = new Map(latest.current)
        next.delete(key)
        commit(next)
      }
    }
  }

  return { preferenceFor, savePreference } as const
}
