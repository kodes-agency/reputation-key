import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
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
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreference,
} from '#/contexts/notification/application/public-api'
import { NotificationsCategoryRow } from './notifications-category-row'
import { CATEGORY_COPY } from './notifications-type-rows'

export type NotificationPreferencePatch = Partial<
  Pick<
    NotificationPreference,
    'enabled' | 'cadence' | 'urgentBypassEnabled' | 'quietHoursStart' | 'quietHoursEnd'
  >
>

type NotificationsSettingsViewProps = Readonly<{
  properties: readonly Readonly<{ id: string; name: string }>[]
  propertyId: string
  locale: string
  timezone: string
  /**
   * Whether `notification.send_email` is allowed for the SELECTED property.
   *
   * Email delivery is a non-core capability allowlisted per property, so every
   * email write is refused server-side when it is off. This screen used to
   * render the whole Email column fully enabled regardless and report the
   * refusal as a generic "could not update" toast, which reads as a broken page
   * rather than an unavailable feature.
   */
  emailAllowed: boolean
  setPropertyId: (value: string) => void
  setLocale: (value: string) => void
  setTimezone: (value: string) => void
  saveUserSettings: () => void
  preferenceFor: (
    category: NotificationCategory,
    channel: NotificationChannel,
  ) => NotificationPreference | undefined
  savePreference: (
    category: NotificationCategory,
    channel: NotificationChannel,
    patch: NotificationPreferencePatch,
  ) => Promise<void>
}>

export function NotificationsSettingsView(props: NotificationsSettingsViewProps) {
  return (
    <div className="min-w-0 space-y-6">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Property</CardTitle>
          <CardDescription>
            Preferences and email batches are isolated per property.
          </CardDescription>
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
            Used for notification formatting. Daily digests remain property-local.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            A real form, so Enter submits. These were bare inputs beside a bare
            button: typing a timezone and pressing Enter did nothing at all.
          */}
          <form
            className="grid min-w-0 gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              props.saveUserSettings()
            }}
          >
            <Field className="min-w-0">
              <FieldLabel htmlFor="notifications-locale">Locale</FieldLabel>
              <Input
                id="notifications-locale"
                className="min-w-0"
                value={props.locale}
                onChange={(event) => props.setLocale(event.target.value)}
              />
            </Field>
            <Field className="min-w-0">
              <FieldLabel htmlFor="notifications-timezone">IANA timezone</FieldLabel>
              <Input
                id="notifications-timezone"
                className="min-w-0"
                value={props.timezone}
                onChange={(event) => props.setTimezone(event.target.value)}
              />
            </Field>
            <Button type="submit" className="w-fit">
              Save formatting
            </Button>
          </form>
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
              savePreference={props.savePreference}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
