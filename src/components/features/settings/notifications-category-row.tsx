import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
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
import type { NotificationPreferencePatch } from './notifications-settings-view'
import type { PreferenceValues } from './notification-preference-saves'
import { namesInBrief, type SetDifferently } from './notification-apply-everywhere'

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
  // offered cadence is shown, but there is nothing to choose, and the dimmed
  // control says why rather than leaving a screen reader with "dimmed".
  const cadences = offeredEmailCadences(category)
  const fixed = cadences.length < 2
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={`${category}-cadence`}>Cadence</FieldLabel>
      <Select
        value={effectiveEmailCadence(category, cadence)}
        disabled={disabled || fixed}
        onValueChange={(value) =>
          void savePreference(category, 'email', {
            cadence: value as NotificationCadence,
          })
        }
      >
        <SelectTrigger
          id={`${category}-cadence`}
          aria-label={named(categoryLabel, 'Cadence')}
          aria-describedby={fixed ? `${category}-cadence-fixed` : undefined}
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

/**
 * Cadence only shapes email, so while email is off it cannot take effect. It
 * waits, its value kept, until email is on. Quiet hours and the urgent bypass
 * used to live here too; they are the person's now, in their own card (ADR
 * 0046, amended 2026-09-23).
 */
function EmailTiming({
  email,
  disabled,
  emailSwitchedOff,
  ...control
}: CategoryControlProps &
  Readonly<{
    email: PreferenceValues | undefined
    disabled: boolean
    /** Off by the reader's choice, not locked or unavailable. */
    emailSwitchedOff: boolean
  }>) {
  const offered = offeredEmailCadences(control.category)
  const only = offered.length === 1 ? offered[0] : undefined
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4 md:col-span-3 md:col-start-1">
      <CadenceSelect {...control} cadence={email?.cadence} disabled={disabled} />
      {only ? (
        // Turning email on changes nothing here, so no hint promises a choice.
        <p
          id={`${control.category}-cadence-fixed`}
          className="basis-full text-sm text-muted-foreground"
        >
          Always emailed {CADENCE_LABELS[only].toLowerCase()}.
        </p>
      ) : emailSwitchedOff ? (
        <p className="basis-full text-sm text-muted-foreground">
          Turn on email to choose when it arrives.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The same answer for every property the person has, and for every property
 * they are given next — which used to fall through to the versioned defaults,
 * so a newly added property mailed urgent notices at 03:00 whatever the person
 * had chosen everywhere else.
 *
 * It replaces what other properties were set to, a mute made from the bell
 * included, so when any has a setting of its own the button asks first and
 * names them. It used to replace them without a word.
 */
function ApplyToAllProperties({
  category,
  categoryLabel,
  inherited,
  propertyCount,
  setDifferently,
  applyToAll,
}: Readonly<{
  category: ConfigurableNotificationCategory
  categoryLabel: string
  inherited: string
  propertyCount: number
  /** The other properties whose own setting this replaces. */
  setDifferently: ReadonlyArray<SetDifferently>
  applyToAll: (category: ConfigurableNotificationCategory) => Promise<void>
}>) {
  const noteId = `${category}-inherited`
  const apply = () => void applyToAll(category)
  const asks = setDifferently.length > 0
  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={named(categoryLabel, 'Apply to all my properties')}
      aria-describedby={noteId}
      disabled={propertyCount < 2}
      onClick={asks ? undefined : apply}
    >
      Apply to all my properties
    </Button>
  )
  const count = setDifferently.length
  const includesMute = setDifferently.some((property) => property.muted)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 md:col-span-3 md:col-start-1">
      {asks ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Replace the settings at {count} other{' '}
                {count === 1 ? 'property' : 'properties'}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {namesInBrief(setDifferently.map((property) => property.name))}{' '}
                {count === 1 ? 'has its' : 'have their'} own {categoryLabel.toLowerCase()}{' '}
                settings
                {includesMute ? ', including a mute from the notification bell' : ''}.
                Applying to all your properties replaces them with the settings you chose
                here.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep them</AlertDialogCancel>
              <AlertDialogAction onClick={apply}>Apply to all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        button
      )}
      <p id={noteId} className="text-sm text-muted-foreground">
        {inherited}
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
  inherited,
  propertyCount,
  setDifferently,
  savePreference,
  applyToAll,
}: Readonly<{
  category: ConfigurableNotificationCategory
  label: string
  description: string
  inApp: PreferenceValues | undefined
  email: PreferenceValues | undefined
  emailAllowed: boolean
  /** What a property with no row of its own gets, in words. */
  inherited: string
  /** Applying to all is not an offer when there is only one property. */
  propertyCount: number
  /** The other properties whose own setting "Apply to all" would replace. */
  setDifferently: ReadonlyArray<SetDifferently>
  savePreference: SavePreference
  applyToAll: (category: ConfigurableNotificationCategory) => Promise<void>
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
      />
      <ApplyToAllProperties
        category={category}
        categoryLabel={label}
        inherited={inherited}
        propertyCount={propertyCount}
        setDifferently={setDifferently}
        applyToAll={applyToAll}
      />
    </fieldset>
  )
}
