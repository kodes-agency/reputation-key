import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import {
  getDefaultEnabled,
  type NotificationCadence,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreference,
} from '#/contexts/notification/application/public-api'
import { CATEGORY_ROWS } from './notifications-type-rows'
import { QuietHoursEditor } from './quiet-hours-editor'

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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Property</CardTitle>
          <CardDescription>
            Preferences and email batches are isolated per property.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label className="grid max-w-sm gap-2">
            Property
            <select
              className="rounded-md border bg-background px-3 py-2"
              value={props.propertyId}
              onChange={(event) => props.setPropertyId(event.target.value)}
            >
              {props.properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </Label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Language and timezone</CardTitle>
          <CardDescription>
            Used for notification formatting. Daily digests remain property-local.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Label className="grid gap-2">
            Locale
            <Input
              value={props.locale}
              onChange={(event) => props.setLocale(event.target.value)}
            />
          </Label>
          <Label className="grid gap-2">
            IANA timezone
            <Input
              value={props.timezone}
              onChange={(event) => props.setTimezone(event.target.value)}
            />
          </Label>
          <button
            type="button"
            className="w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={props.saveUserSettings}
          >
            Save formatting
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Property notifications</CardTitle>
          <CardDescription>
            Email is evaluated again against this property, your preferences, and current
            policy before every provider call.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {CATEGORY_ROWS.map(({ category, label, description }) => {
            const inApp = props.preferenceFor(category, 'in_app')
            const email = props.preferenceFor(category, 'email')
            const mandatory = category === 'mandatory'
            return (
              <fieldset
                key={category}
                className="grid gap-4 py-5 md:grid-cols-[1fr_auto_auto]"
              >
                <legend className="font-medium">{label}</legend>
                <p className="text-sm text-muted-foreground md:col-start-1">
                  {description}
                </p>
                <Label className="flex items-center gap-2 md:col-start-2 md:row-start-1">
                  <Switch
                    id={`${category}-in_app`}
                    checked={inApp?.enabled ?? getDefaultEnabled(category, 'in_app')}
                    disabled={mandatory}
                    onCheckedChange={(enabled) =>
                      void props.savePreference(category, 'in_app', { enabled })
                    }
                  />
                  In-app
                </Label>
                <Label className="flex items-center gap-2 md:col-start-3 md:row-start-1">
                  <Switch
                    id={`${category}-email`}
                    checked={email?.enabled ?? getDefaultEnabled(category, 'email')}
                    disabled={mandatory}
                    onCheckedChange={(enabled) =>
                      void props.savePreference(category, 'email', { enabled })
                    }
                  />
                  Email
                </Label>
                <div className="flex flex-wrap items-center gap-4 md:col-span-2 md:col-start-2">
                  <Label className="flex items-center gap-2">
                    <select
                      className="rounded-md border bg-background px-2 py-1"
                      value={
                        email?.cadence ??
                        (category === 'urgent_operational' ? 'immediate' : 'daily')
                      }
                      onChange={(event) =>
                        void props.savePreference(category, 'email', {
                          cadence: event.target.value as NotificationCadence,
                        })
                      }
                    >
                      <option value="immediate">Immediate</option>
                      <option value="daily">Daily at 08:00</option>
                    </select>
                    Cadence
                  </Label>
                  <QuietHoursEditor
                    key={`${category}:${email?.quietHoursStart}:${email?.quietHoursEnd}`}
                    start={email?.quietHoursStart ?? null}
                    end={email?.quietHoursEnd ?? null}
                    onSave={(quietHoursStart, quietHoursEnd) =>
                      void props.savePreference(category, 'email', {
                        quietHoursStart,
                        quietHoursEnd,
                      })
                    }
                  />
                  {category === 'urgent_operational' ? (
                    <Label className="flex items-center gap-2">
                      <Switch
                        id={`${category}-urgent-bypass`}
                        checked={email?.urgentBypassEnabled ?? false}
                        onCheckedChange={(urgentBypassEnabled) =>
                          void props.savePreference(category, 'email', {
                            urgentBypassEnabled,
                          })
                        }
                      />
                      Allow urgent email to bypass quiet hours
                    </Label>
                  ) : null}
                </div>
              </fieldset>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
