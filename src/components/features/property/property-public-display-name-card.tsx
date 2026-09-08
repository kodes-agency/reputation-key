import { useForm } from '@tanstack/react-form'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { FieldGroup } from '#/components/ui/field'
import { portalBrandFormInputSchema } from '#/contexts/portal/application/dto/portal-experience.dto'
import { usePermissions } from '#/shared/hooks/usePermissions'

type PropertyBrandProfile = Readonly<{
  displayName: string
  primaryColor: string
  backgroundColor: string
  textColor: string
}> | null

type SavePublicDisplayNameAction = Action<{
  data: {
    propertyId: string
    displayName: string
    primaryColor: string
    backgroundColor: string
    textColor: string
  }
}>

export function PropertyPublicDisplayNameCard({
  propertyId,
  profile,
  action,
}: Readonly<{
  propertyId: string
  profile: PropertyBrandProfile
  action: SavePublicDisplayNameAction
}>) {
  const { can } = usePermissions()
  const canManage = can('portal.admin')
  const form = useForm({
    defaultValues: {
      displayName: profile?.displayName ?? '',
      primaryColor: profile?.primaryColor ?? '#2563EB',
      backgroundColor: profile?.backgroundColor ?? '#FFFFFF',
      textColor: profile?.textColor ?? '#111827',
    },
    validators: { onSubmit: portalBrandFormInputSchema },
    onSubmit: async ({ value }) => {
      const parsed = portalBrandFormInputSchema.parse(value)
      await action({ data: { propertyId, ...parsed } })
    },
  })

  return (
    <form onSubmit={submitHandler(form)}>
      <Card>
        <CardHeader>
          <CardTitle>Public display name</CardTitle>
          <CardDescription>
            Used as the business identity in AI-drafted public replies. This Property-wide
            name can be set before any Portal is created; Portal settings continue to own
            colours and the guest-facing theme.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <form.Field name="displayName">
              {(field: BaseFieldApi) => (
                <FormTextField
                  field={field}
                  id="property-public-display-name"
                  label="Public display name"
                  maxLength={120}
                  disabled={!canManage || action.isPending}
                />
              )}
            </form.Field>
          </FieldGroup>
          {!canManage ? (
            <p className="text-sm text-muted-foreground">
              Ask an account admin to set this property&rsquo;s public display name.
            </p>
          ) : null}
          <FormErrorBanner error={action.error} />
        </CardContent>
        {canManage ? (
          <CardFooter className="justify-end">
            <SubmitButton mutation={action} form={form}>
              Save public display name
            </SubmitButton>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  )
}
