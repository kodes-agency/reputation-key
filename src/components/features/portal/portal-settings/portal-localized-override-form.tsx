import { useForm } from '@tanstack/react-form'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { FieldGroup } from '#/components/ui/field'
import { portalLocalizedOverrideFormInputSchema } from '#/contexts/portal/application/dto/portal-experience.dto'
import type {
  GuestLocale,
  PortalExperienceActions,
} from './portal-experience-settings-types'

export function PortalLocalizedOverrideForm({
  locale,
  portalId,
  initialTitle,
  initialDescription,
  titlePlaceholder,
  descriptionPlaceholder,
  action,
  disabled,
}: Readonly<{
  locale: GuestLocale
  portalId: string
  initialTitle: string
  initialDescription: string
  titlePlaceholder: string
  descriptionPlaceholder: string
  action: PortalExperienceActions['saveOverride']
  disabled: boolean
}>) {
  const form = useForm({
    defaultValues: { title: initialTitle, shortDescription: initialDescription },
    validators: { onSubmit: portalLocalizedOverrideFormInputSchema },
    onSubmit: async ({ value }) => {
      const parsed = portalLocalizedOverrideFormInputSchema.parse(value)
      await action({ data: { portalId, locale, ...parsed } })
    },
  })
  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <div>
        <p className="text-sm font-medium">This Portal only</p>
        <p className="text-xs text-muted-foreground">
          Leave a field empty to inherit the Property fallback.
        </p>
      </div>
      <FieldGroup>
        <form.Field name="title">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              id={`portal-override-title-${locale}`}
              label="Title override"
              placeholder={titlePlaceholder}
              maxLength={120}
              disabled={disabled || action.isPending}
            />
          )}
        </form.Field>
        <form.Field name="shortDescription">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id={`portal-override-description-${locale}`}
              label="Description override"
              placeholder={descriptionPlaceholder}
              maxLength={500}
              disabled={disabled || action.isPending}
            />
          )}
        </form.Field>
      </FieldGroup>
      <SubmitButton mutation={action} form={form} variant="outline" disabled={disabled}>
        Save Portal override
      </SubmitButton>
    </form>
  )
}
