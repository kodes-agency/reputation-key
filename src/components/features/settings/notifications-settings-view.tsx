import type { Action } from '#/components/hooks/use-action'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  NOTIFICATION_SETTINGS_CATEGORIES,
  type ConfigurableNotificationCategory,
  type EffectiveNotificationSettings,
  type NotificationChannel,
} from '#/contexts/feed/application/public-api'
import { describeTimezone } from '#/shared/timezone-display'
import { NotificationsCategoryRow } from './notifications-category-row'
import type { PreferencePatch, PreferenceValues } from './notification-preference-saves'
import { CATEGORY_COPY } from './notifications-type-rows'
import {
  NotificationFormattingForm,
  type NotificationSettingsUpdate,
} from './notification-formatting-form'

export type NotificationPreferencePatch = PreferencePatch

export type { NotificationSettingsUpdate } from './notification-formatting-form'

type NotificationsSettingsViewProps = Readonly<{
  properties: readonly Readonly<{ id: string; name: string }>[]
  propertyId: string
  /** The language and timezone delivery uses now, Organization fallback applied. */
  settings: EffectiveNotificationSettings
  /** The selected Property's server-enforced email capability decision. */
  emailAllowed: boolean
  setPropertyId: (value: string) => void
  updateUserSettings: Action<NotificationSettingsUpdate, EffectiveNotificationSettings>
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
  return (
    <div className="min-w-0 space-y-6">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Property</CardTitle>
          <CardDescription>Each property keeps its own preferences.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="notifications-property">Property</FieldLabel>
            <Select value={props.propertyId} onValueChange={props.setPropertyId}>
              <SelectTrigger
                id="notifications-property"
                className="h-11 min-h-11 w-full min-w-0 max-w-full"
                aria-label="Property"
              >
                <SelectValue placeholder="Select a property" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {props.properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Language and timezone</CardTitle>
          <CardDescription>
            Your timezone decides when quiet hours start and end and when the daily digest
            arrives (08:00), for every property. Notification times are shown in it too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationFormattingForm
            settings={props.settings}
            updateUserSettings={props.updateUserSettings}
          />
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Property notifications</CardTitle>
          <CardDescription>
            Email is evaluated again against this property, your preferences, and current
            policy before every provider call.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {!props.emailAllowed ? (
            <p
              role="status"
              className="pb-5 text-sm text-muted-foreground"
              data-testid="email-unavailable-notice"
            >
              Email delivery is not enabled for this property, so the email controls below
              are unavailable. In-app notifications are unaffected.
            </p>
          ) : null}
          {NOTIFICATION_SETTINGS_CATEGORIES.map((category) => (
            <NotificationsCategoryRow
              key={category}
              category={category}
              label={CATEGORY_COPY[category].label}
              description={CATEGORY_COPY[category].description}
              inApp={props.preferenceFor(category, 'in_app')}
              email={props.preferenceFor(category, 'email')}
              emailAllowed={props.emailAllowed}
              clockLabel={clockLabel}
              savePreference={props.savePreference}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
