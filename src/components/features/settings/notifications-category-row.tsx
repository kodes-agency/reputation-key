import { SectionTitle } from '#/components/ui/section-title'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
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
import type { SetDifferently } from './notification-apply-everywhere'
import { DefaultControls, named } from './notification-default-controls'
import { LowRatingSelect } from './notifications-low-ratings-controls'

const CADENCE_LABELS: Readonly<Record<NotificationCadence, string>> = {
  immediate: 'Immediate',
  daily: 'Daily at 08:00',
}

type SavePreference = (
  category: ConfigurableNotificationCategory,
  channel: 'in_app' | 'email',
  patch: NotificationPreferencePatch,
) => Promise<boolean>

/** What every control in one category's row knows about that category. */
type CategoryControlProps = Readonly<{
  category: ConfigurableNotificationCategory
  categoryLabel: string
  savePreference: SavePreference
}>

function InAppSwitch({
  category,
  categoryLabel,
  savePreference,
  inApp,
}: CategoryControlProps & Readonly<{ inApp: PreferenceValues | undefined }>) {
  const locked = !isPreferenceDisableable(category, 'in_app')
  return (
    <SettingSwitchRow
      id={`${category}-in_app`}
      label="In-app"
      accessibleName={named(categoryLabel, 'In-app')}
      note={locked ? 'Always on' : undefined}
      commit="immediate"
      checked={inApp?.enabled ?? getDefaultEnabled(category, 'in_app')}
      disabled={locked}
      onCheckedChange={(enabled) => savePreference(category, 'in_app', { enabled })}
      className="md:col-start-2 md:row-start-1"
    />
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
          className="w-44 min-w-0"
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

export function NotificationsCategoryRow({
  category,
  label,
  description,
  inApp,
  email,
  emailAllowed,
  inherited,
  setDifferently,
  ownHere,
  propertyInView,
  savePreference,
  applyToAll,
  resetToDefault,
}: Readonly<{
  category: ConfigurableNotificationCategory
  label: string
  description: string
  inApp: PreferenceValues | undefined
  email: PreferenceValues | undefined
  emailAllowed: boolean
  /** What a property with no row of its own gets, in words. */
  inherited: string
  /** The other properties with a setting of their own, which a default keeps. */
  setDifferently: ReadonlyArray<SetDifferently>
  /** This property has a setting of its own for the category. */
  ownHere: boolean
  propertyInView: string
  savePreference: SavePreference
  applyToAll: (category: ConfigurableNotificationCategory) => Promise<void>
  resetToDefault: (
    category: ConfigurableNotificationCategory,
    propertyIds: ReadonlyArray<string>,
  ) => Promise<void>
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
      <SectionTitle level={3} id={headingId} className="min-w-0">
        {label}
      </SectionTitle>
      <p className="min-w-0 text-sm text-muted-foreground md:col-start-1">
        {description}
      </p>
      {category === 'low_ratings' ? (
        // How low, per channel, in place of an on/off switch.
        <>
          <LowRatingSelect
            channel="in_app"
            categoryLabel={label}
            values={inApp}
            onChange={(patch) => void savePreference(category, 'in_app', patch)}
            className="w-auto md:col-start-2 md:row-start-1"
          />
          <LowRatingSelect
            channel="email"
            categoryLabel={label}
            values={email}
            disabled={emailControlsDisabled}
            onChange={(patch) => void savePreference(category, 'email', patch)}
            className="w-auto md:col-start-3 md:row-start-1"
          />
        </>
      ) : (
        <>
          <InAppSwitch {...control} inApp={inApp} />
          <SettingSwitchRow
            id={`${category}-email`}
            label="Email"
            accessibleName={named(label, 'Email')}
            commit="immediate"
            checked={emailOn}
            disabled={emailControlsDisabled}
            onCheckedChange={(enabled) => savePreference(category, 'email', { enabled })}
            className="md:col-start-3 md:row-start-1"
          />
        </>
      )}
      <EmailTiming
        {...control}
        email={email}
        disabled={emailControlsDisabled || !emailOn}
        emailSwitchedOff={!emailControlsDisabled && !emailOn}
      />
      <DefaultControls
        category={category}
        categoryLabel={label}
        inherited={inherited}
        setDifferently={setDifferently}
        ownHere={ownHere}
        propertyInView={propertyInView}
        applyToAll={applyToAll}
        resetToDefault={resetToDefault}
      />
    </fieldset>
  )
}
