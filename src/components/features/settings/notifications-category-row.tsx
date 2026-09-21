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
  getDefaultCadence,
  getDefaultEnabled,
  isPreferenceDisableable,
  type ConfigurableNotificationCategory,
  type NotificationCadence,
} from '#/contexts/feed/application/public-api'
import { QuietHoursEditor } from './quiet-hours-editor'
import type { NotificationPreferencePatch } from './notifications-settings-view'
import type { PreferenceValues } from './notification-preference-saves'

export function NotificationsCategoryRow({
  category,
  label,
  description,
  inApp,
  email,
  emailAllowed,
  clockLabel,
  savePreference,
}: Readonly<{
  category: ConfigurableNotificationCategory
  label: string
  description: string
  inApp: PreferenceValues | undefined
  email: PreferenceValues | undefined
  emailAllowed: boolean
  /** The recipient's delivery clock, e.g. "Sofia (UTC+3)" (ADR 0046 r.3). */
  clockLabel: string
  savePreference: (
    category: ConfigurableNotificationCategory,
    channel: 'in_app' | 'email',
    patch: NotificationPreferencePatch,
  ) => Promise<void>
}>) {
  const inAppLocked = !isPreferenceDisableable(category, 'in_app')
  const emailLocked = !isPreferenceDisableable(category, 'email')
  const emailControlsDisabled = emailLocked || !emailAllowed
  const headingId = `${category}-heading`
  const lockedNoteId = `${category}-in_app-locked`
  // Every row repeats "In-app", "Email", "Cadence" and "Quiet from", so each
  // control's name carries the category: a screen-reader user tabbing through
  // otherwise cannot tell which category a control changes.
  const named = (control: string) => `${label}: ${control}`
  // The title track carries an explicit floor and the controls row spans the
  // whole grid. With `1fr auto auto` and the controls row spanning only columns
  // 2-3, that 670px row sized both `auto` tracks to the full width of the
  // fieldset and left `1fr` at ZERO — measured — so the title and description
  // wrapped one character per line. `min-w-0` on the text made it worse by
  // removing the min-content floor that had been hiding the squeeze.
  return (
    <fieldset
      aria-labelledby={headingId}
      className="grid min-w-0 gap-4 py-5 md:grid-cols-[minmax(12rem,1fr)_auto_auto]"
    >
      {/*
        Not a <legend>: a legend is not a grid item, so the explicit
        col-start/row-start placements below computed against a grid it never
        joined and the category title floated away from its own controls.
      */}
      <div id={headingId} role="heading" aria-level={3} className="min-w-0 font-medium">
        {label}
      </div>
      <p className="min-w-0 text-sm text-muted-foreground md:col-start-1">
        {description}
      </p>
      <div className="flex items-center gap-2 md:col-start-2 md:row-start-1">
        <Label className="flex items-center gap-2">
          <Switch
            id={`${category}-in_app`}
            checked={inApp?.enabled ?? getDefaultEnabled(category, 'in_app')}
            disabled={inAppLocked}
            aria-label={named('In-app')}
            aria-describedby={inAppLocked ? lockedNoteId : undefined}
            onCheckedChange={(enabled) =>
              void savePreference(category, 'in_app', { enabled })
            }
          />
          In-app
        </Label>
        {inAppLocked ? (
          <span id={lockedNoteId} className="text-sm text-muted-foreground">
            Always on
          </span>
        ) : null}
      </div>
      <Label className="flex items-center gap-2 md:col-start-3 md:row-start-1">
        <Switch
          id={`${category}-email`}
          checked={email?.enabled ?? getDefaultEnabled(category, 'email')}
          disabled={emailControlsDisabled}
          aria-label={named('Email')}
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
            value={email?.cadence ?? getDefaultCadence(category)}
            disabled={emailControlsDisabled}
            onValueChange={(value) =>
              void savePreference(category, 'email', {
                cadence: value as NotificationCadence,
              })
            }
          >
            <SelectTrigger
              id={`${category}-cadence`}
              aria-label={named('Cadence')}
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
          categoryLabel={label}
          disabled={emailControlsDisabled}
          onSave={(quietHoursStart, quietHoursEnd) =>
            void savePreference(category, 'email', { quietHoursStart, quietHoursEnd })
          }
        />
        {category === 'urgent_operational' ? (
          <Label className="flex items-center gap-2">
            <Switch
              id={`${category}-urgent-bypass`}
              checked={email?.urgentBypassEnabled ?? false}
              disabled={emailControlsDisabled}
              aria-label={named('Allow urgent email to bypass quiet hours')}
              onCheckedChange={(urgentBypassEnabled) =>
                void savePreference(category, 'email', { urgentBypassEnabled })
              }
            />
            Allow urgent email to bypass quiet hours
          </Label>
        ) : null}
        <p className="basis-full text-sm text-muted-foreground">
          The daily digest and quiet hours use your timezone, {clockLabel}.
        </p>
      </div>
    </fieldset>
  )
}
