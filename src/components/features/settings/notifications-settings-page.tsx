import { useState } from 'react'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import {
  getDefaultEnabled,
  type NotificationCadence,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreference,
  type NotificationUserSettings,
} from '#/contexts/notification/application/public-api'
import {
  NotificationsSettingsView,
  type NotificationPreferencePatch,
} from './notifications-settings-view'

type PreferenceUpdate = Readonly<{
  data: Readonly<{
    propertyId: string
    category: NotificationCategory
    channel: NotificationChannel
    enabled: boolean
    cadence: NotificationCadence
    urgentBypassEnabled: boolean
    quietHoursStart: string | null
    quietHoursEnd: string | null
  }>
}>

type SettingsUpdate = Readonly<{
  data: Readonly<{ locale: string; timezone: string }>
}>

type Props = Readonly<{
  properties: readonly Readonly<{ id: string; name: string }>[]
  preferences: readonly NotificationPreference[]
  userSettings: NotificationUserSettings | null
  updatePreference: Action<PreferenceUpdate, NotificationPreference>
  updateUserSettings: Action<SettingsUpdate, NotificationUserSettings>
}>

export function NotificationsSettingsPage({
  properties,
  preferences,
  userSettings,
  updatePreference,
  updateUserSettings,
}: Props) {
  const [locale, setLocale] = useState(userSettings?.locale ?? 'en')
  const [timezone, setTimezone] = useState(userSettings?.timezone ?? 'UTC')
  const [localPreferences, setLocalPreferences] = useState(preferences)
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '')

  const preferenceFor = (category: NotificationCategory, channel: NotificationChannel) =>
    localPreferences.find(
      (preference) =>
        preference.propertyId === propertyId &&
        preference.category === category &&
        preference.channel === channel,
    )

  const savePreference = async (
    category: NotificationCategory,
    channel: NotificationChannel,
    patch: NotificationPreferencePatch,
  ) => {
    const current = preferenceFor(category, channel)
    const input = {
      propertyId,
      category,
      channel,
      enabled: patch.enabled ?? current?.enabled ?? getDefaultEnabled(category, channel),
      cadence:
        patch.cadence ??
        current?.cadence ??
        (category === 'urgent_operational' ? 'immediate' : 'daily'),
      urgentBypassEnabled:
        patch.urgentBypassEnabled ?? current?.urgentBypassEnabled ?? false,
      quietHoursStart: patch.quietHoursStart ?? current?.quietHoursStart ?? null,
      quietHoursEnd: patch.quietHoursEnd ?? current?.quietHoursEnd ?? null,
    } as const
    try {
      const saved = await updatePreference({ data: input })
      setLocalPreferences((existing) => [
        ...existing.filter(
          (preference) =>
            !(
              preference.propertyId === propertyId &&
              preference.category === category &&
              preference.channel === channel
            ),
        ),
        saved,
      ])
      toast.success('Notification preference updated')
    } catch {
      toast.error('Could not update notification preference')
    }
  }

  return (
    <NotificationsSettingsView
      properties={properties}
      propertyId={propertyId}
      locale={locale}
      timezone={timezone}
      setPropertyId={setPropertyId}
      setLocale={setLocale}
      setTimezone={setTimezone}
      preferenceFor={preferenceFor}
      savePreference={savePreference}
      saveUserSettings={() =>
        void updateUserSettings({ data: { locale, timezone } })
          .then(() => toast.success('Notification formatting updated'))
          .catch(() => toast.error('Could not update notification formatting'))
      }
    />
  )
}
