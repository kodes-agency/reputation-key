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
  locale: OfferedGuestLocale
  portalId: string
  initialTitle: string
  initialDescription: string
  titlePlaceholder: string
  descriptionPlaceholder: string
  action: PortalExperienceActions['saveOverride']
  disabled: boolean
}>) {
  // This portal's own wording is part of its draft, so it saves as it is typed
  // (unlike the property-wide fallback above it, which keeps an explicit Save).
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
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(event) => event.preventDefault()}
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
              disabled={disabled}
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
              disabled={disabled}
            />
          )}
        </form.Field>
      </FieldGroup>
    </form>
  )
}
