import type { Action } from '#/components/hooks/use-action'
import type {
  EffectiveNotificationSettings,
  NotificationCategoryDefault,
  NotificationPreference,
  NotificationPropertyDeliveryWindow,
} from '#/contexts/feed/application/public-api'
import { NotificationsSettingsView } from './notifications-settings-view'
import type { EmailAvailability } from './email-availability-notice'
import { describeInheritedDefault } from './notification-inherited-defaults'
import { hasOwnSetting, setDifferentlyElsewhere } from './notification-apply-everywhere'
import type { QuietHoursUpdate } from './notification-quiet-hours-card'
import {
  useNotificationPreferenceSaves,
  type PreferenceUpdate,
} from './use-notification-preference-saves'
import type { PreferenceReset } from './notification-preference-writes'

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
  /** The check is running again after a failure; the notice stays, its button busy. */
  emailAvailabilityRetrying?: boolean
  setPropertyId: (value: string) => void
  updatePreference: Action<PreferenceUpdate, NotificationPreference>
  resetPropertyCategory: Action<PreferenceReset, void>
  updateQuietHours: Action<QuietHoursUpdate, EffectiveNotificationSettings>
}>

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
  emailAvailabilityRetrying,
  setPropertyId,
  updatePreference,
  resetPropertyCategory,
  updateQuietHours,
}: Props) {
  // The values delivery uses, never a UTC placeholder: a user who never saved
  // a timezone is on their Organization's (ADR 0046 r.3).
  const settings = userSettings ?? NO_ORGANIZATION_SETTINGS
  // Pending edits overlay the query result until the category's writes settle.
  const { preferenceFor, savePreference, applyToAll, resetToDefault } =
    useNotificationPreferenceSaves({
      propertyId,
      preferences,
      categoryDefaults,
      emailAllowed: emailAvailability === 'allowed',
      updatePreference,
      resetPropertyCategory,
    })
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
      emailAvailabilityRetrying={emailAvailabilityRetrying}
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
      updateQuietHours={updateQuietHours}
    />
  )
}
