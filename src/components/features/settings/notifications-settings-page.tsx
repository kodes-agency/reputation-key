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
import { toast } from 'sonner'
import {
  hasOwnSetting,
  setDifferentlyElsewhere,
  type SetDifferently,
} from './notification-apply-everywhere'
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
  resetPropertyCategory: Action<
    Readonly<{
      data: Readonly<{ propertyId: string; category: ConfigurableNotificationCategory }>
    }>,
    void
  >
  updateUserSettings: Action<NotificationSettingsUpdate, EffectiveNotificationSettings>
  updateQuietHours: Action<QuietHoursUpdate, EffectiveNotificationSettings>
}>

type BoundaryProps = Omit<
  Props,
  | 'userSettings'
  | 'preferences'
  | 'updatePreference'
  | 'categoryDefaults'
  | 'resetPropertyCategory'
> &
  Readonly<{
    settings: EffectiveNotificationSettings
    inheritedFor: (category: ConfigurableNotificationCategory) => string
    setDifferentlyFor: (
      category: ConfigurableNotificationCategory,
    ) => ReadonlyArray<SetDifferently>
    ownSettingHere: (category: ConfigurableNotificationCategory) => boolean
    resetToDefault: (
      category: ConfigurableNotificationCategory,
      propertyIds: ReadonlyArray<string>,
    ) => Promise<void>
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
  resetPropertyCategory,
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
    emailAllowed: emailAvailability === 'allowed',
    updatePreference,
  })
  // D7: a reset is the explicit way an exception ends. One at a time, so a
  // failure part-way leaves the ones before it reset — and says so: the
  // action has no toast of its own, so this is the only word the reader gets.
  const resetToDefault = async (
    category: ConfigurableNotificationCategory,
    propertyIds: ReadonlyArray<string>,
  ) => {
    let done = 0
    for (const id of propertyIds) {
      try {
        await resetPropertyCategory({ data: { propertyId: id, category } })
      } catch {
        toast.error(
          done === 0
            ? "Couldn't reset to your default. Try again."
            : `${done} of ${propertyIds.length} properties now follow your default; the rest couldn't be reset. Try again.`,
        )
        return
      }
      done += 1
    }
    toast.success(
      propertyIds.length === 1 && propertyIds[0] === propertyId
        ? 'This property now follows your default'
        : `${done} ${done === 1 ? 'property now follows' : 'properties now follow'} your default`,
    )
  }
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
      setDifferentlyFor={(category) =>
        setDifferentlyElsewhere(category, preferences, properties, propertyId)
      }
      ownSettingHere={(category) => hasOwnSetting(category, preferences, propertyId)}
      resetToDefault={resetToDefault}
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
  setDifferentlyFor,
  ownSettingHere,
  resetToDefault,
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
      setDifferentlyFor={setDifferentlyFor}
      ownSettingHere={ownSettingHere}
      resetToDefault={resetToDefault}
      updateUserSettings={updateUserSettings}
      updateQuietHours={updateQuietHours}
    />
  )
}
