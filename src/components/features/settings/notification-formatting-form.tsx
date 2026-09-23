import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import { TimezoneCombobox } from '#/components/forms/timezone-combobox'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
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
  en: 'English (US) — 9/23/2026, 3:00 PM',
  'en-GB': 'English (UK) — 23/09/2026, 15:00',
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
      try {
        await updateUserSettings({ data })
        toast.success('Notification formatting updated')
      } catch {
        toast.error('Could not update notification formatting')
      }
    },
  })

  return (
    <form className="grid min-w-0 gap-4 sm:grid-cols-2" onSubmit={submitHandler(form)}>
      <FormErrorBanner error={updateUserSettings.error} />
      <form.Field name="timezone">
        {(field) => (
          <Field className="min-w-0">
            <FieldLabel htmlFor="notifications-timezone">Timezone</FieldLabel>
            <TimezoneCombobox
              id="notifications-timezone"
              value={field.state.value}
              onValueChange={field.handleChange}
              onBlur={field.handleBlur}
              disabled={pending}
              aria-describedby="notifications-timezone-source"
              className="h-11 min-h-11"
            />
            <p
              id="notifications-timezone-source"
              data-testid="timezone-source"
              className="text-sm text-muted-foreground"
            >
              {TIMEZONE_SOURCE_HINT[settings.timezoneSource]}
            </p>
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Field name="locale">
        {(field) => (
          <Field className="min-w-0">
            <FieldLabel htmlFor="notifications-locale">Date and time format</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={field.handleChange}
              disabled={pending}
            >
              <SelectTrigger
                id="notifications-locale"
                className="h-11 min-h-11 w-full min-w-0"
              >
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
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <SubmitButton
            mutation={updateUserSettings}
            form={form}
            // Nothing to save until something differs from what is in effect.
            disabled={
              Object.keys(changedNotificationFormatting(settings, values)).length === 0
            }
            className="w-fit"
          >
            Save formatting
          </SubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}
