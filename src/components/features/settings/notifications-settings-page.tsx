import { useState } from 'react'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import {
  getDefaultEnabled,
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
    cadence: NotificationPreference['cadence']
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
  propertyId: string
  emailAllowed: boolean
  setPropertyId: (value: string) => void
  updatePreference: Action<PreferenceUpdate, NotificationPreference>
  updateUserSettings: Action<SettingsUpdate, NotificationUserSettings>
}>

export function NotificationsSettingsPage({
  properties,
  preferences,
  userSettings,
  propertyId,
  emailAllowed,
  setPropertyId,
  updatePreference,
  updateUserSettings,
}: Props) {
  return (
    <NotificationFormattingBoundary
      // Remounting on the server values is the re-sync. The locale and timezone
      // inputs need local edit state, but seeding it once meant a refetch — or
      // another session — never reached the fields. Keying on the persisted
      // values reseeds them exactly when the server truth changes and never
      // while the user is mid-edit.
      key={`${userSettings?.locale ?? 'en'}:${userSettings?.timezone ?? 'UTC'}`}
      properties={properties}
      preferences={preferences}
      userSettings={userSettings}
      propertyId={propertyId}
      emailAllowed={emailAllowed}
      setPropertyId={setPropertyId}
      updatePreference={updatePreference}
      updateUserSettings={updateUserSettings}
    />
  )
}

function NotificationFormattingBoundary({
  properties,
  preferences,
  userSettings,
  propertyId,
  emailAllowed,
  setPropertyId,
  updatePreference,
  updateUserSettings,
}: Props) {
  const [locale, setLocale] = useState(userSettings?.locale ?? 'en')
  const [timezone, setTimezone] = useState(userSettings?.timezone ?? 'UTC')

  // Read straight from the query result. There used to be a `localPreferences`
  // mirror seeded once from this prop and patched by hand after each save,
  // which made it the only render source: the mutation invalidates and the
  // query refetches, but nothing re-seeded the mirror, so persisted state never
  // reached the screen and any server-side normalisation was invisible.
  const preferenceFor = (category: NotificationCategory, channel: NotificationChannel) =>
    preferences.find(
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
      await updatePreference({ data: input })
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
      emailAllowed={emailAllowed}
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
