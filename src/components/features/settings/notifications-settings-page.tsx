import type { Action } from '#/components/hooks/use-action'
import type {
  ConfigurableNotificationCategory,
  EffectiveNotificationSettings,
  NotificationCategoryDefault,
  NotificationPreference,
  NotificationPropertyDeliveryWindow,
} from '#/contexts/feed/application/public-api'
import {
  NotificationsSettingsView,
  type NotificationSettingsUpdate,
} from './notifications-settings-view'
import type { EmailAvailability } from './email-availability-notice'
import { describeInheritedDefault } from './notification-inherited-defaults'
import type { QuietHoursUpdate } from './notification-quiet-hours-card'
import {
  useNotificationPreferenceSaves,
  type PreferenceUpdate,
} from './use-notification-preference-saves'

type Props = Readonly<{
  properties: readonly Readonly<{ id: string; name: string }>[]
  preferences: readonly NotificationPreference[]
  /** What a property with no row of its own inherits, per (category, channel). */
  categoryDefaults: readonly NotificationCategoryDefault[]
  /** The properties that override the person's quiet hours. */
  propertyWindows: readonly NotificationPropertyDeliveryWindow[]
  /** Null only without an active Organization, where nothing is configurable. */
  userSettings: EffectiveNotificationSettings | null
  propertyId: string
  emailAvailability: EmailAvailability
  retryEmailAvailability: () => void
  setPropertyId: (value: string) => void
  updatePreference: Action<PreferenceUpdate, NotificationPreference>
  updateUserSettings: Action<NotificationSettingsUpdate, EffectiveNotificationSettings>
  updateQuietHours: Action<QuietHoursUpdate, EffectiveNotificationSettings>
}>

type BoundaryProps = Omit<
  Props,
  'userSettings' | 'preferences' | 'updatePreference' | 'categoryDefaults'
> &
  Readonly<{
    settings: EffectiveNotificationSettings
    inheritedFor: (category: ConfigurableNotificationCategory) => string
  }> &
  ReturnType<typeof useNotificationPreferenceSaves>

/** What delivery falls back to when there is no Organization to ask. */
const NO_ORGANIZATION_SETTINGS: EffectiveNotificationSettings = {
  locale: 'en',
  timezone: 'UTC',
  timezoneSource: 'default',
  quietHoursStart: null,
  quietHoursEnd: null,
  urgentBypassEnabled: false,
}

export function NotificationsSettingsPage({
  properties,
  preferences,
  categoryDefaults,
  propertyWindows,
  userSettings,
  propertyId,
  emailAvailability,
  retryEmailAvailability,
  setPropertyId,
  updatePreference,
  updateUserSettings,
  updateQuietHours,
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
  const { preferenceFor, savePreference, applyToAll } = useNotificationPreferenceSaves({
    propertyId,
    preferences,
    categoryDefaults,
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
      propertyWindows={propertyWindows}
      settings={settings}
      propertyId={propertyId}
      emailAvailability={emailAvailability}
      retryEmailAvailability={retryEmailAvailability}
      setPropertyId={setPropertyId}
      preferenceFor={preferenceFor}
      savePreference={savePreference}
      applyToAll={applyToAll}
      inheritedFor={(category) => describeInheritedDefault(category, categoryDefaults)}
      updateUserSettings={updateUserSettings}
      updateQuietHours={updateQuietHours}
    />
  )
}

function NotificationFormattingBoundary({
  properties,
  propertyWindows,
  settings,
  propertyId,
  emailAvailability,
  retryEmailAvailability,
  setPropertyId,
  preferenceFor,
  savePreference,
  applyToAll,
  inheritedFor,
  updateUserSettings,
  updateQuietHours,
}: BoundaryProps) {
  const override =
    propertyWindows.find((window) => (window.propertyId as string) === propertyId) ?? null
  return (
    <NotificationsSettingsView
      properties={properties}
      propertyId={propertyId}
      settings={settings}
      quietHoursOverride={override}
      emailAvailability={emailAvailability}
      retryEmailAvailability={retryEmailAvailability}
      setPropertyId={setPropertyId}
      preferenceFor={preferenceFor}
      savePreference={savePreference}
      applyToAll={applyToAll}
      inheritedFor={inheritedFor}
      updateUserSettings={updateUserSettings}
      updateQuietHours={updateQuietHours}
    />
  )
}
