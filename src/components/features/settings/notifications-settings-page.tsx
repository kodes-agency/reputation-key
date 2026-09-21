import type { Action } from '#/components/hooks/use-action'
import type {
  EffectiveNotificationSettings,
  NotificationPreference,
} from '#/contexts/feed/application/public-api'
import {
  NotificationsSettingsView,
  type NotificationSettingsUpdate,
} from './notifications-settings-view'
import type { EmailAvailability } from './email-availability-notice'
import {
  useNotificationPreferenceSaves,
  type PreferenceUpdate,
} from './use-notification-preference-saves'

type Props = Readonly<{
  properties: readonly Readonly<{ id: string; name: string }>[]
  preferences: readonly NotificationPreference[]
  /** Null only without an active Organization, where nothing is configurable. */
  userSettings: EffectiveNotificationSettings | null
  propertyId: string
  emailAvailability: EmailAvailability
  retryEmailAvailability: () => void
  setPropertyId: (value: string) => void
  updatePreference: Action<PreferenceUpdate, NotificationPreference>
  updateUserSettings: Action<NotificationSettingsUpdate, EffectiveNotificationSettings>
}>

type BoundaryProps = Omit<Props, 'userSettings' | 'preferences' | 'updatePreference'> &
  Readonly<{ settings: EffectiveNotificationSettings }> &
  ReturnType<typeof useNotificationPreferenceSaves>

/** What delivery falls back to when there is no Organization to ask. */
const NO_ORGANIZATION_SETTINGS: EffectiveNotificationSettings = {
  locale: 'en',
  timezone: 'UTC',
  timezoneSource: 'default',
}

export function NotificationsSettingsPage({
  properties,
  preferences,
  userSettings,
  propertyId,
  emailAvailability,
  retryEmailAvailability,
  setPropertyId,
  updatePreference,
  updateUserSettings,
}: Props) {
  // The values delivery uses, never a UTC placeholder: a user who never saved
  // a timezone is on their Organization's (ADR 0046 r.3).
  const settings = userSettings ?? NO_ORGANIZATION_SETTINGS
  // Read straight from the query result, with each row's in-flight request on
  // top. There used to be a `localPreferences` mirror seeded once from this
  // prop and patched by hand after each save, which made it the only render
  // source: nothing re-seeded it after a refetch, so persisted state never
  // reached the screen. The overlay lasts only until a row's saves settle, and
  // it lives above the boundary so a formatting save cannot reset a queue.
  const { preferenceFor, savePreference } = useNotificationPreferenceSaves({
    propertyId,
    preferences,
    updatePreference,
  })
  return (
    <NotificationFormattingBoundary
      // Remounting on the server values is the re-sync. The locale and timezone
      // inputs need local edit state, but seeding it once meant a refetch — or
      // another session — never reached the fields. Keying on the effective
      // values reseeds them exactly when the server truth changes and never
      // while the user is mid-edit.
      key={`${settings.locale}:${settings.timezone}:${settings.timezoneSource}`}
      properties={properties}
      settings={settings}
      propertyId={propertyId}
      emailAvailability={emailAvailability}
      retryEmailAvailability={retryEmailAvailability}
      setPropertyId={setPropertyId}
      preferenceFor={preferenceFor}
      savePreference={savePreference}
      updateUserSettings={updateUserSettings}
    />
  )
}

function NotificationFormattingBoundary({
  properties,
  settings,
  propertyId,
  emailAvailability,
  retryEmailAvailability,
  setPropertyId,
  preferenceFor,
  savePreference,
  updateUserSettings,
}: BoundaryProps) {
  return (
    <NotificationsSettingsView
      properties={properties}
      propertyId={propertyId}
      settings={settings}
      emailAvailability={emailAvailability}
      retryEmailAvailability={retryEmailAvailability}
      setPropertyId={setPropertyId}
      preferenceFor={preferenceFor}
      savePreference={savePreference}
      updateUserSettings={updateUserSettings}
    />
  )
}
