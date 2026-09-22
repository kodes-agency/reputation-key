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
  effectiveEmailCadence,
  getDefaultEnabled,
  isPreferenceDisableable,
  offeredEmailCadences,
  type ConfigurableNotificationCategory,
  type NotificationCadence,
} from '#/contexts/feed/application/public-api'
import { QuietHoursEditor } from './quiet-hours-editor'
import type { NotificationPreferencePatch } from './notifications-settings-view'
import type { PreferenceValues } from './notification-preference-saves'

const CADENCE_LABELS: Readonly<Record<NotificationCadence, string>> = {
  immediate: 'Immediate',
  daily: 'Daily at 08:00',
}

type SavePreference = (
  category: ConfigurableNotificationCategory,
  channel: 'in_app' | 'email',
  patch: NotificationPreferencePatch,
) => Promise<void>

/** What every control in one category's row knows about that category. */
type CategoryControlProps = Readonly<{
  category: ConfigurableNotificationCategory
  categoryLabel: string
  savePreference: SavePreference
}>

// Every row repeats "In-app", "Email", "Cadence" and "Quiet from", so each
// control's name carries the category: a screen-reader user tabbing through
// otherwise cannot tell which category a control changes.
const named = (categoryLabel: string, control: string) => `${categoryLabel}: ${control}`

function InAppSwitch({
  category,
  categoryLabel,
  savePreference,
  inApp,
}: CategoryControlProps & Readonly<{ inApp: PreferenceValues | undefined }>) {
  const locked = !isPreferenceDisableable(category, 'in_app')
  const lockedNoteId = `${category}-in_app-locked`
  return (
    <div className="flex items-center gap-2 md:col-start-2 md:row-start-1">
      <Label className="flex items-center gap-2">
        <Switch
          id={`${category}-in_app`}
          checked={inApp?.enabled ?? getDefaultEnabled(category, 'in_app')}
          disabled={locked}
          aria-label={named(categoryLabel, 'In-app')}
          aria-describedby={locked ? lockedNoteId : undefined}
          onCheckedChange={(enabled) =>
            void savePreference(category, 'in_app', { enabled })
          }
        />
        In-app
      </Label>
      {locked ? (
        <span id={lockedNoteId} className="text-sm text-muted-foreground">
          Always on
        </span>
      ) : null}
    </div>
  )
}

function CadenceSelect({
  category,
  categoryLabel,
  savePreference,
  cadence,
  disabled,
}: CategoryControlProps &
  Readonly<{ cadence: NotificationCadence | undefined; disabled: boolean }>) {
  // Goals are emailed daily only (ADR 0046, amended 2026-09-22): the one
  // offered cadence is shown, but there is nothing to choose.
  const cadences = offeredEmailCadences(category)
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={`${category}-cadence`}>Cadence</FieldLabel>
      <Select
        value={effectiveEmailCadence(category, cadence)}
        disabled={disabled || cadences.length < 2}
        onValueChange={(value) =>
          void savePreference(category, 'email', {
            cadence: value as NotificationCadence,
          })
        }
      >
        <SelectTrigger
          id={`${category}-cadence`}
          aria-label={named(categoryLabel, 'Cadence')}
          className="h-11 min-h-11 w-44 min-w-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {cadences.map((option) => (
              <SelectItem key={option} value={option}>
                {CADENCE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function UrgentBypassSwitch({
  category,
  categoryLabel,
  savePreference,
  checked,
  disabled,
}: CategoryControlProps & Readonly<{ checked: boolean; disabled: boolean }>) {
  return (
    <Label className="flex items-center gap-2">
      <Switch
        id={`${category}-urgent-bypass`}
        checked={checked}
        disabled={disabled}
        aria-label={named(categoryLabel, 'Allow urgent email to bypass quiet hours')}
        onCheckedChange={(urgentBypassEnabled) =>
          void savePreference(category, 'email', { urgentBypassEnabled })
        }
      />
      Allow urgent email to bypass quiet hours
    </Label>
  )
}

/**
 * Cadence, quiet hours and the urgent bypass only shape email, so while email
 * is off they cannot take effect. They wait, values kept, until it is on.
 */
function EmailTiming({
  email,
  disabled,
  emailSwitchedOff,
  clockLabel,
  ...control
}: CategoryControlProps &
  Readonly<{
    email: PreferenceValues | undefined
    disabled: boolean
    /** Off by the reader's choice, not locked or unavailable. */
    emailSwitchedOff: boolean
    clockLabel: string
  }>) {
  const { category, categoryLabel, savePreference } = control
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4 md:col-span-3 md:col-start-1">
      <CadenceSelect {...control} cadence={email?.cadence} disabled={disabled} />
      <QuietHoursEditor
        key={`${category}:${email?.quietHoursStart}:${email?.quietHoursEnd}`}
        start={email?.quietHoursStart ?? null}
        end={email?.quietHoursEnd ?? null}
        categoryLabel={categoryLabel}
        disabled={disabled}
        onSave={(quietHoursStart, quietHoursEnd) =>
          void savePreference(category, 'email', { quietHoursStart, quietHoursEnd })
        }
      />
      {category === 'urgent_operational' ? (
        <UrgentBypassSwitch
          {...control}
          checked={email?.urgentBypassEnabled ?? false}
          disabled={disabled}
        />
      ) : null}
      {emailSwitchedOff ? (
        <p className="basis-full text-sm text-muted-foreground">
          Turn on email to choose when it arrives.
        </p>
      ) : null}
      <p className="basis-full text-sm text-muted-foreground">
        The daily digest and quiet hours use your timezone, {clockLabel}.
      </p>
    </div>
  )
}

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
  savePreference: SavePreference
}>) {
  const control = { category, categoryLabel: label, savePreference }
  const emailControlsDisabled =
    !isPreferenceDisableable(category, 'email') || !emailAllowed
  const emailOn = email?.enabled ?? getDefaultEnabled(category, 'email')
  const headingId = `${category}-heading`
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
      <InAppSwitch {...control} inApp={inApp} />
      <Label className="flex items-center gap-2 md:col-start-3 md:row-start-1">
        <Switch
          id={`${category}-email`}
          checked={emailOn}
          disabled={emailControlsDisabled}
          aria-label={named(label, 'Email')}
          onCheckedChange={(enabled) =>
            void savePreference(category, 'email', { enabled })
          }
        />
        Email
      </Label>
      <EmailTiming
        {...control}
        email={email}
        disabled={emailControlsDisabled || !emailOn}
        emailSwitchedOff={!emailControlsDisabled && !emailOn}
        clockLabel={clockLabel}
      />
    </fieldset>
  )
}
