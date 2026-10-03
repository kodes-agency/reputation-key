import { useForm } from '@tanstack/react-form'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { FieldGroup } from '#/components/ui/field'
import { portalLocalizedOverrideFormInputSchema } from '#/contexts/portal/application/dto/portal-experience.dto'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalExperienceActions } from './portal-experience-settings-types'
import { usePortalFormAutosave } from '../portal-editor/use-portal-form-autosave'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

/**
 * This portal's own welcome line and link preview in one language. Part of the
 * portal's draft, so they save as they are typed (unlike the property's wording
 * below them, which keeps an explicit Save). Empty, they use the property's
 * wording, which the placeholders show.
 */
export function PortalLocalizedOverrideForm({
  locale,
  portalId,
  propertyName,
  initialTitle,
  initialDescription,
  titlePlaceholder,
  descriptionPlaceholder,
  action,
  disabled,
}: Readonly<{
  locale: OfferedGuestLocale
  portalId: string
  /** The large name guests read, which the welcome line sits above; null while there is none. */
  propertyName: string | null
  initialTitle: string
  initialDescription: string
  titlePlaceholder: string
  descriptionPlaceholder: string
  action: PortalExperienceActions['saveOverride']
  disabled: boolean
}>) {
  const defaults = { title: initialTitle, shortDescription: initialDescription }
  const autosave = usePortalFormAutosave(`override-${locale}`, defaults)
  const form = useForm({
    defaultValues: defaults,
    listeners: autosave.listeners,
    validators: { onSubmit: portalLocalizedOverrideFormInputSchema },
    onSubmit: async ({ value }) => {
      const parsed = portalLocalizedOverrideFormInputSchema.parse(value)
      await action({ data: { portalId, locale, ...parsed } })
    },
  })
  return (
    // The write is the coordinator's, so Enter must not also submit natively.
    <form onSubmit={(event) => event.preventDefault()}>
      <FieldGroup>
        <form.Field name="title">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              id={`portal-override-title-${locale}`}
              label="Welcome line"
              placeholder={titlePlaceholder}
              maxLength={120}
              disabled={disabled}
              hint={`The line guests read above ${propertyName ?? 'the property’s name'}, such as Spa reception.`}
            />
          )}
        </form.Field>
        <form.Field name="shortDescription">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id={`portal-override-description-${locale}`}
              label="Link preview"
              placeholder={descriptionPlaceholder}
              maxLength={500}
              rows={2}
              disabled={disabled}
              hint="Shown with the page’s link when it is shared in a chat app."
            />
          )}
        </form.Field>
      </FieldGroup>
      {/* Autosaved, so there is no button to sit above: the refusal ends the form. */}
      <FormErrorBanner error={action.error} />
    </form>
  )
}
