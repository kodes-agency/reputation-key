import { useForm } from '@tanstack/react-form'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FieldGroup } from '#/components/ui/field'
import { portalBrandFormInputSchema } from '#/contexts/portal/application/dto/portal-experience.dto'
import { PortalBrandColorField } from './portal-brand-color-field'
import { PortalExperienceActionError } from './portal-experience-action-error'
import type {
  PortalExperienceActions,
  PortalExperienceSettings,
} from './portal-experience-settings-types'

export function PortalPropertyBrandEditor({
  propertyId,
  experience,
  action,
  disabled,
}: Readonly<{
  propertyId: string
  experience: PortalExperienceSettings
  action: PortalExperienceActions['saveProfile']
  disabled: boolean
}>) {
  const form = useForm({
    defaultValues: {
      displayName: experience.profile?.displayName ?? '',
      primaryColor: experience.profile?.primaryColor ?? '#2563EB',
      backgroundColor: experience.profile?.backgroundColor ?? '#FFFFFF',
      textColor: experience.profile?.textColor ?? '#111827',
    },
    validators: { onSubmit: portalBrandFormInputSchema },
    onSubmit: async ({ value }) => {
      const parsed = portalBrandFormInputSchema.parse(value)
      await action({ data: { propertyId, ...parsed } })
    },
  })
  const readOnly = disabled || !experience.canManagePropertyBrand

  return (
    <form
      className="space-y-3 rounded-md border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <div>
        <h4 className="font-medium">Property brand</h4>
        <p className="text-sm text-muted-foreground">
          Shared defaults used by every Portal for this Property.
          {!experience.canManagePropertyBrand
            ? ' An Account Admin manages these defaults.'
            : ''}
        </p>
      </div>
      <FieldGroup>
        <form.Field name="displayName">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              id="portal-brand-display-name"
              label="Public display name"
              maxLength={120}
              disabled={readOnly || action.isPending}
            />
          )}
        </form.Field>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['primaryColor', 'backgroundColor', 'textColor'] as const).map(
            (name, index) => (
              <form.Field key={name} name={name}>
                {(field: BaseFieldApi) => (
                  <PortalBrandColorField
                    field={field}
                    label={['Primary', 'Background', 'Text'][index]}
                    disabled={readOnly || action.isPending}
                  />
                )}
              </form.Field>
            ),
          )}
        </div>
      </FieldGroup>
      {!readOnly ? (
        <SubmitButton mutation={action} form={form} variant="outline">
          Save property brand
        </SubmitButton>
      ) : null}
      <PortalExperienceActionError action={action} />
    </form>
  )
}
