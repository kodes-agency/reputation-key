import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { submitHandler } from '#/components/forms/form-submit'
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
  // The public display name is owned by Property settings → Profile. It is
  // still sent unchanged, because the brand profile saves as one record.
  const displayName = experience.profile?.displayName ?? ''

  return (
    <form className="space-y-3 rounded-md border p-4" onSubmit={submitHandler(form)}>
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
        <p className="text-sm">
          <span className="text-muted-foreground">Public display name · </span>
          {displayName || 'Not set'}{' '}
          <Link
            to="/properties/$propertyId/settings/profile"
            params={{ propertyId }}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {displayName ? 'Change in property profile' : 'Set it in property profile'}
          </Link>
        </p>
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
      {!readOnly && displayName ? (
        <SubmitButton mutation={action} form={form} variant="outline">
          Save brand colours
        </SubmitButton>
      ) : null}
      <PortalExperienceActionError action={action} />
    </form>
  )
}
