import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import type {
  EffectiveNotificationSettings,
  NotificationTimezoneSource,
} from '#/contexts/feed/application/public-api'
import {
  notificationFormattingFormDto,
  notificationUserSettingsDto,
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

type FormattingValues = Readonly<{ locale: string; timezone: string }>

const TIMEZONE_SOURCE_HINT: Readonly<Record<NotificationTimezoneSource, string>> = {
  user: 'Your own timezone.',
  organization: "Your organization's timezone. Choose another to set your own.",
  default: 'Neither you nor your organization has a timezone yet, so UTC is used.',
}

/**
 * Only what the user changed. The fields start on the values delivery already
 * uses, so sending an untouched timezone back would pin the Organization's zone
 * — or, before this, a UTC placeholder — as the user's own choice.
 */
function changedFormatting(
  settings: EffectiveNotificationSettings,
  value: FormattingValues,
): NotificationUserSettingsInput {
  return {
    ...(value.locale === settings.locale ? {} : { locale: value.locale }),
    ...(value.timezone === settings.timezone ? {} : { timezone: value.timezone }),
  }
}

export function NotificationFormattingForm({ settings, updateUserSettings }: Props) {
  const form = useForm({
    defaultValues: {
      locale: settings.locale,
      timezone: settings.timezone,
    } satisfies FormattingValues,
    validators: { onSubmit: notificationFormattingFormDto },
    onSubmit: async ({ value }) => {
      const data = notificationUserSettingsDto.parse(changedFormatting(settings, value))
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
      <form.Field name="locale">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            id="notifications-locale"
            label="Locale"
            maxLength={35}
            disabled={updateUserSettings.isPending}
          />
        )}
      </form.Field>
      <div className="grid min-w-0 content-start gap-2">
        <form.Field name="timezone">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              id="notifications-timezone"
              label="IANA timezone"
              maxLength={64}
              disabled={updateUserSettings.isPending}
            />
          )}
        </form.Field>
        <p className="text-sm text-muted-foreground" data-testid="timezone-source">
          {TIMEZONE_SOURCE_HINT[settings.timezoneSource]}
        </p>
      </div>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <SubmitButton
            mutation={updateUserSettings}
            form={form}
            // Nothing to save until something differs from what is in effect.
            disabled={Object.keys(changedFormatting(settings, values)).length === 0}
            className="w-fit"
          >
            Save formatting
          </SubmitButton>
        )}
      </form.Subscribe>
    </form>
  )
}
