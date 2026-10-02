import { useForm } from '@tanstack/react-form'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { FieldGroup } from '#/components/ui/field'
import { propertyPortalBrandContentInputSchema } from '#/contexts/portal/application/dto/portal-experience.dto'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalExperienceActions } from './portal-experience-settings-types'
import { useExplicitDraftGuard } from '../portal-editor/use-portal-form-autosave'

const propertyContentFormSchema = propertyPortalBrandContentInputSchema
  .pick({ title: true, shortDescription: true })
  .required()

/**
 * The property's welcome line and link preview in one language: what every
 * portal of the property starts from. Property-wide, so it keeps an explicit
 * Save, and only an account admin may change it.
 */
export function PortalPropertyContentForm({
  locale,
  propertyId,
  initialTitle,
  initialDescription,
  action,
  readOnly,
}: Readonly<{
  locale: OfferedGuestLocale
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
  useExplicitDraftGuard(`content-${locale}`, form)
  return (
    <form className="space-y-3" onSubmit={submitHandler(form)}>
      <FieldGroup>
        <form.Field name="title">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              id={`portal-content-title-${locale}`}
              label="Welcome line"
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
              label="Link preview"
              rows={2}
              maxLength={500}
              disabled={readOnly || action.isPending}
            />
          )}
        </form.Field>
      </FieldGroup>
      {!readOnly ? (
        <SubmitButton mutation={action} form={form} variant="outline">
          Save property wording
        </SubmitButton>
      ) : null}
    </form>
  )
}
