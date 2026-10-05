import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { PropertyPicker } from '#/components/property/property-picker'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  NOTIFICATION_SETTINGS_CATEGORIES,
  type ConfigurableNotificationCategory,
  type EffectiveNotificationSettings,
  type NotificationChannel,
  type PersonalDeliveryWindow,
} from '#/contexts/feed/application/public-api'
import { describeTimezone } from '#/shared/timezone-display'
import { NotificationsCategoryRow } from './notifications-category-row'
import {
  EmailAvailabilityNotice,
  type EmailAvailability,
} from './email-availability-notice'
import type { PreferencePatch, PreferenceValues } from './notification-preference-saves'
import type { SetDifferently } from './notification-apply-everywhere'
import { CATEGORY_COPY } from './notifications-type-rows'
import {
  NotificationQuietHoursCard,
  type QuietHoursUpdate,
} from './notification-quiet-hours-card'

export type NotificationPreferencePatch = PreferencePatch

type NotificationsSettingsViewProps = Readonly<{
  properties: readonly Readonly<{ id: string; name: string }>[]
  propertyId: string
  /** The quiet hours and the clock delivery uses now, Organization fallback applied. */
  settings: EffectiveNotificationSettings
  /** The selected Property's server-enforced email capability, as far as known. */
  emailAvailability: EmailAvailability
  retryEmailAvailability: () => void
  emailAvailabilityRetrying?: boolean
  setPropertyId: (value: string) => void
  updateQuietHours: Action<QuietHoursUpdate, EffectiveNotificationSettings>
  /** This property's override of the person's quiet hours, if it has one. */
  quietHoursOverride: PersonalDeliveryWindow | null
  /** What a property with no row of its own inherits, per category. */
  inheritedFor: (category: ConfigurableNotificationCategory) => string
  /** The other properties whose own setting "Apply to all" would replace. */
  setDifferentlyFor: (
    category: ConfigurableNotificationCategory,
  ) => ReadonlyArray<SetDifferently>
  /** Whether the property in view has a setting of its own for the category. */
  ownSettingHere: (category: ConfigurableNotificationCategory) => boolean
  /** Removes the named properties' own settings for a category (D7). */
  resetToDefault: (
    category: ConfigurableNotificationCategory,
    propertyIds: ReadonlyArray<string>,
  ) => Promise<void>
  applyToAll: (category: ConfigurableNotificationCategory) => Promise<void>
  preferenceFor: (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
  ) => PreferenceValues | undefined
  savePreference: (
    category: ConfigurableNotificationCategory,
    channel: NotificationChannel,
    patch: NotificationPreferencePatch,
  ) => Promise<void>
}>

export function NotificationsSettingsView(props: NotificationsSettingsViewProps) {
  const clockLabel = describeTimezone(props.settings.timezone).label
  const emailAllowed = props.emailAvailability === 'allowed'
  const selected = props.properties.find((property) => property.id === props.propertyId)
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <div className="min-w-0 space-y-6">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle as="h2">Property</CardTitle>
          <CardDescription>
            In-app and email delivery is per property; quiet hours below are yours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="notifications-property">Property</FieldLabel>
            {/*
              The Inbox's searchable select (#582), not a plain <select>: a
              manager with thirty properties had to scroll a flat list to find
              one, in the one place where every property needs visiting.
            */}
            <PropertyPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              triggerId="notifications-property"
              triggerLabel={selected?.name ?? 'Select a property'}
              triggerAriaLabel={`Property: ${selected?.name ?? 'none selected'}`}
              heading="Notification settings by property"
              activeValue={props.propertyId}
              groups={[
                props.properties.map((property) => ({
                  value: property.id,
                  label: property.name,
                })),
              ]}
              onSelect={(value) => {
                setPickerOpen(false)
                props.setPropertyId(value)
              }}
            />
          </Field>
        </CardContent>
      </Card>

      {selected ? (
        // Keyed by Property: whether the card edits an override is seeded
        // from the Property's own window, so another Property starts afresh
        // rather than inheriting the last one's mode.
        <NotificationQuietHoursCard
          key={selected.id}
          settings={props.settings}
          property={selected}
          override={props.quietHoursOverride}
          clockLabel={clockLabel}
          updateQuietHours={props.updateQuietHours}
        />
      ) : null}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle as="h2">Property notifications</CardTitle>
          <CardDescription>
            Email is evaluated again against this property, your preferences, and current
            policy before every provider call.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <EmailAvailabilityNotice
            availability={props.emailAvailability}
            onRetry={props.retryEmailAvailability}
            retrying={props.emailAvailabilityRetrying}
          />
          {NOTIFICATION_SETTINGS_CATEGORIES.map((category) => (
            <NotificationsCategoryRow
              key={category}
              category={category}
              label={CATEGORY_COPY[category].label}
              description={CATEGORY_COPY[category].description}
              inApp={props.preferenceFor(category, 'in_app')}
              email={props.preferenceFor(category, 'email')}
              emailAllowed={emailAllowed}
              inherited={props.inheritedFor(category)}
              setDifferently={props.setDifferentlyFor(category)}
              ownHere={props.ownSettingHere(category)}
              propertyInView={props.propertyId}
              resetToDefault={props.resetToDefault}
              savePreference={props.savePreference}
              applyToAll={props.applyToAll}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
