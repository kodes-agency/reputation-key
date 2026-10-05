import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { FormActions } from '#/components/forms/form-actions'
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import { TimezoneCombobox } from '#/components/forms/timezone-combobox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type {
  EffectiveNotificationSettings,
  NotificationTimezoneSource,
} from '#/contexts/feed/application/public-api'
import {
  changedNotificationFormatting,
  NOTIFICATION_LOCALES,
  notificationFormattingFormDto,
  type NotificationFormattingValues,
  type NotificationLocale,
  type NotificationUserSettingsInput,
} from '#/contexts/feed/application/dto/notification-user-settings.dto'

export type NotificationSettingsUpdate = Readonly<{
  data: NotificationUserSettingsInput
}>

type Props = Readonly<{
  /** What delivery uses now: the saved values, or the Organization's timezone. */
  settings: EffectiveNotificationSettings
  updateUserSettings: Action<NotificationSettingsUpdate, EffectiveNotificationSettings>
}>

const TIMEZONE_SOURCE_HINT: Readonly<Record<NotificationTimezoneSource, string>> = {
  user: 'Your own timezone.',
  organization: "Your organization's timezone. Choose another to set your own.",
  default: 'Neither you nor your organization has a timezone yet, so UTC is used.',
}

const LOCALE_LABELS: Readonly<Record<NotificationLocale, string>> = {
  en: 'English (US)',
  'en-GB': 'English (UK)',
}

/**
 * A fixed afternoon in a month whose number is above 12, so the sample shows
 * which of the day and the month comes first and whether the clock is 24-hour.
 * The preview is the whole point of the control: the names alone ("English
 * (UK)") do not say what changes.
 */
const SAMPLE_INSTANT = new Date('2026-09-23T15:04:00.000Z')

function formatSample(locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone,
    }).format(SAMPLE_INSTANT)
  } catch {
    // A legacy locale or a fixed-offset zone the pickers no longer offer.
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(SAMPLE_INSTANT)
  }
}

/** The offered formats, plus a stored legacy one so the select never hides it. */
function localeOptions(stored: string) {
  const offered = NOTIFICATION_LOCALES.map((locale) => ({
    value: locale as string,
    label: LOCALE_LABELS[locale],
  }))
  return offered.some((option) => option.value === stored)
    ? offered
    : [{ value: stored, label: stored }, ...offered]
}

export function NotificationFormattingForm({ settings, updateUserSettings }: Props) {
  const pending = updateUserSettings.isPending
  // Validates what the save will carry: only the changed fields, by the save's
  // own rules, so an untouched value delivery is using is never judged.
  const formattingDto = notificationFormattingFormDto(settings)
  const form = useForm({
    defaultValues: {
      locale: settings.locale,
      timezone: settings.timezone,
    } satisfies NotificationFormattingValues,
    validators: { onSubmit: formattingDto },
    onSubmit: async ({ value }) => {
      const data = formattingDto.parse(value)
      // A refusal is the banner above the button (the action holds it); only
      // the success is a toast.
      await updateUserSettings({ data })
      toast.success('Timezone and date format saved')
    },
  })

  return (
    <form className="grid min-w-0 gap-4 sm:grid-cols-2" onSubmit={submitHandler(form)}>
      <form.Field name="timezone">
        {(field) => {
          const source = (
            <span data-testid="timezone-source">
              {TIMEZONE_SOURCE_HINT[settings.timezoneSource]}
            </span>
          )
          return (
            <FormFieldFrame
              id="profile-timezone"
              label="Timezone"
              description={source}
              invalid={field.state.meta.errors.length > 0}
              errors={field.state.meta.errors}
              className="min-w-0"
            >
              <TimezoneCombobox
                id="profile-timezone"
                value={field.state.value}
                onValueChange={field.handleChange}
                onBlur={field.handleBlur}
                disabled={pending}
                aria-describedby={describedByOf('profile-timezone', source)}
              />
            </FormFieldFrame>
          )
        }}
      </form.Field>
      <form.Field name="locale">
        {(field) => (
          <FormFieldFrame
            id="profile-locale"
            label="Date and time format"
            description={
              <span data-testid="format-sample">
                Times are written like{' '}
                {formatSample(field.state.value, settings.timezone)}.
              </span>
            }
            invalid={field.state.meta.errors.length > 0}
            errors={field.state.meta.errors}
            className="min-w-0"
          >
            <Select
              value={field.state.value}
              onValueChange={field.handleChange}
              disabled={pending}
            >
              <SelectTrigger id="profile-locale" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {localeOptions(settings.locale).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormFieldFrame>
        )}
      </form.Field>
      <FormActions form={form} error={updateUserSettings.error} className="sm:col-span-2">
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <SubmitButton
              mutation={updateUserSettings}
              form={form}
              // Nothing to save until something differs from what is in effect.
              disabled={
                Object.keys(changedNotificationFormatting(settings, values)).length === 0
              }
            >
              Save timezone and format
            </SubmitButton>
          )}
        </form.Subscribe>
      </FormActions>
    </form>
  )
}
