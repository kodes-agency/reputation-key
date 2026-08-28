import { useForm } from '@tanstack/react-form'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { FieldGroup } from '#/components/ui/field'
import { propertyPortalBrandContentInputSchema } from '#/contexts/portal/application/dto/portal-experience.dto'
import type {
  GuestLocale,
  PortalExperienceActions,
} from './portal-experience-settings-types'

const propertyContentFormSchema = propertyPortalBrandContentInputSchema
  .pick({ title: true, shortDescription: true })
  .required()

export function PortalPropertyContentForm({
  locale,
  propertyId,
  initialTitle,
  initialDescription,
  action,
  readOnly,
}: Readonly<{
  locale: GuestLocale
  propertyId: string
  initialTitle: string
  initialDescription: string
  action: PortalExperienceActions['saveContent']
  readOnly: boolean
}>) {
  const form = useForm({
    defaultValues: { title: initialTitle, shortDescription: initialDescription },
    validators: { onSubmit: propertyContentFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = propertyContentFormSchema.parse(value)
      await action({ data: { propertyId, locale, ...parsed } })
    },
  })
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <p className="text-sm text-muted-foreground">Property-wide fallback</p>
      <FieldGroup>
        <form.Field name="title">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              id={`portal-content-title-${locale}`}
              label="Title"
              maxLength={120}
              disabled={readOnly || action.isPending}
            />
          )}
        </form.Field>
        <form.Field name="shortDescription">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id={`portal-content-description-${locale}`}
              label="Description"
              maxLength={500}
              disabled={readOnly || action.isPending}
            />
          )}
        </form.Field>
      </FieldGroup>
      {!readOnly ? (
        <SubmitButton mutation={action} form={form} variant="outline">
          Save Property fallback
        </SubmitButton>
      ) : null}
    </form>
  )
}
