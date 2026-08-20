import { Field, FieldLabel } from '#/components/ui/field'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import {
  getDefaultEnabled,
  type NotificationCadence,
  type NotificationCategory,
  type NotificationPreference,
} from '#/contexts/notification/application/public-api'
import { QuietHoursEditor } from './quiet-hours-editor'
import type { NotificationPreferencePatch } from './notifications-settings-view'

export function NotificationsCategoryRow({
  category,
  label,
  description,
  inApp,
  email,
  emailAllowed,
  savePreference,
}: Readonly<{
  category: NotificationCategory
  label: string
  description: string
  inApp: NotificationPreference | undefined
  email: NotificationPreference | undefined
  emailAllowed: boolean
  savePreference: (
    category: NotificationCategory,
    channel: 'in_app' | 'email',
    patch: NotificationPreferencePatch,
  ) => Promise<void>
}>) {
  const mandatory = category === 'mandatory'
  const emailDisabled = mandatory || !emailAllowed
  // The title track carries an explicit floor and the controls row spans the
  // whole grid. With `1fr auto auto` and the controls row spanning only columns
  // 2-3, that 670px row sized both `auto` tracks to the full width of the
  // fieldset and left `1fr` at ZERO — measured — so the title and description
  // wrapped one character per line. `min-w-0` on the text made it worse by
  // removing the min-content floor that had been hiding the squeeze.
  return (
    <fieldset className="grid min-w-0 gap-4 py-5 md:grid-cols-[minmax(12rem,1fr)_auto_auto]">
      {/*
        Not a <legend>: a legend is not a grid item, so the explicit
        col-start/row-start placements below computed against a grid it never
        joined and the category title floated away from its own controls.
      */}
      <div role="heading" aria-level={3} className="min-w-0 font-medium">
        {label}
      </div>
      <p className="min-w-0 text-sm text-muted-foreground md:col-start-1">
        {description}
      </p>
      <Label className="flex items-center gap-2 md:col-start-2 md:row-start-1">
        <Switch
          id={`${category}-in_app`}
          checked={inApp?.enabled ?? getDefaultEnabled(category, 'in_app')}
          disabled={mandatory}
          onCheckedChange={(enabled) =>
            void savePreference(category, 'in_app', { enabled })
          }
        />
        In-app
      </Label>
      <Label className="flex items-center gap-2 md:col-start-3 md:row-start-1">
        <Switch
          id={`${category}-email`}
          checked={email?.enabled ?? getDefaultEnabled(category, 'email')}
          disabled={emailDisabled}
          onCheckedChange={(enabled) =>
            void savePreference(category, 'email', { enabled })
          }
        />
        Email
      </Label>
      <div className="flex min-w-0 flex-wrap items-center gap-4 md:col-span-3 md:col-start-1">
        <Field className="w-auto">
          <FieldLabel htmlFor={`${category}-cadence`}>Cadence</FieldLabel>
          <Select
            value={
              email?.cadence ??
              (category === 'urgent_operational' ? 'immediate' : 'daily')
            }
            disabled={emailDisabled}
            onValueChange={(value) =>
              void savePreference(category, 'email', {
                cadence: value as NotificationCadence,
              })
            }
          >
            <SelectTrigger
              id={`${category}-cadence`}
              className="h-11 min-h-11 w-44 min-w-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="immediate">Immediate</SelectItem>
                <SelectItem value="daily">Daily at 08:00</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <QuietHoursEditor
          key={`${category}:${email?.quietHoursStart}:${email?.quietHoursEnd}`}
          start={email?.quietHoursStart ?? null}
          end={email?.quietHoursEnd ?? null}
          disabled={emailDisabled}
          onSave={(quietHoursStart, quietHoursEnd) =>
            void savePreference(category, 'email', { quietHoursStart, quietHoursEnd })
          }
        />
        {category === 'urgent_operational' ? (
          <Label className="flex items-center gap-2">
            <Switch
              id={`${category}-urgent-bypass`}
              checked={email?.urgentBypassEnabled ?? false}
              disabled={emailDisabled}
              onCheckedChange={(urgentBypassEnabled) =>
                void savePreference(category, 'email', { urgentBypassEnabled })
              }
            />
            Allow urgent email to bypass quiet hours
          </Label>
        ) : null}
      </div>
    </fieldset>
  )
}
