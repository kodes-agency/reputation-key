import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import type { NotificationUserSettings } from '#/contexts/notification/application/public-api'
import {
  notificationUserSettingsDto,
  type NotificationUserSettingsInput,
} from '#/contexts/notification/application/dto/notification-user-settings.dto'

export type NotificationSettingsUpdate = Readonly<{
  data: NotificationUserSettingsInput
}>

type Props = Readonly<{
  initialLocale: string
  initialTimezone: string
  updateUserSettings: Action<NotificationSettingsUpdate, NotificationUserSettings>
}>

export function NotificationFormattingForm(props: Props) {
  const form = useForm({
    defaultValues: {
      locale: props.initialLocale,
      timezone: props.initialTimezone,
    } satisfies NotificationUserSettingsInput,
    validators: { onSubmit: notificationUserSettingsDto },
    onSubmit: async ({ value }) => {
      const data = notificationUserSettingsDto.parse(value)
      try {
        await props.updateUserSettings({ data })
        toast.success('Notification formatting updated')
      } catch {
        toast.error('Could not update notification formatting')
      }
    },
  })

  return (
    <form
      className="grid min-w-0 gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FormErrorBanner error={props.updateUserSettings.error} />
      <form.Field name="locale">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            id="notifications-locale"
            label="Locale"
            maxLength={35}
            disabled={props.updateUserSettings.isPending}
          />
        )}
      </form.Field>
      <form.Field name="timezone">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            id="notifications-timezone"
            label="IANA timezone"
            maxLength={64}
            disabled={props.updateUserSettings.isPending}
          />
        )}
      </form.Field>
      <SubmitButton mutation={props.updateUserSettings} form={form} className="w-fit">
        Save formatting
      </SubmitButton>
    </form>
  )
}
