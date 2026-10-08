import { useForm } from '@tanstack/react-form'
import type { Action } from '#/components/hooks/use-action'
import { FormActions } from '#/components/forms/form-actions'
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
import { InlineLink } from '#/components/ui/inline-link'
import { propertyPublicDisplayNameFormInputSchema } from '#/contexts/portal/application/dto/portal-experience.dto'
import { usePermissions } from '#/shared/hooks/usePermissions'

/**
 * The name alone. The broader brand writer also sends colours, and a form
 * opened before the Property look changed would write its old ones back.
 */
export type SavePublicDisplayNameAction = Action<{
  data: {
    propertyId: string
    displayName: string
  }
}>

export function PropertyPublicDisplayNameCard({
  propertyId,
  displayName: savedDisplayName,
  action,
  showLookLink = true,
}: Readonly<{
  propertyId: string
  /** The name as saved; empty when the property has none yet. */
  displayName: string
  action: SavePublicDisplayNameAction
  /** Point to Property look for colours, photo and logo; off on Property look itself. */
  showLookLink?: boolean
}>) {
  const { can } = usePermissions()
  const canManage = can('portal.admin')
  const form = useForm({
    defaultValues: { displayName: savedDisplayName },
    validators: { onSubmit: propertyPublicDisplayNameFormInputSchema },
    onSubmit: async ({ value }) => {
      const { displayName } = propertyPublicDisplayNameFormInputSchema.parse(value)
      await action({ data: { propertyId, displayName } })
    },
  })

  return (
    <form onSubmit={submitHandler(form)}>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Public display name</CardTitle>
          <CardDescription>
            Shown to guests at the top of every portal, and used to sign AI-drafted
            replies. It belongs to the whole property, so it can be set before any portal
            exists.
            {showLookLink ? (
              <>
                {' '}
                Colours, photo and logo are in{' '}
                <InlineLink
                  to="/properties/$propertyId/portals/look"
                  params={{ propertyId }}
                  underline="always"
                >
                  Property look
                </InlineLink>
                .
              </>
            ) : null}
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
        </CardContent>
        {canManage ? (
          <CardFooter>
            <FormActions form={form} error={action.error}>
              <SubmitButton mutation={action} form={form}>
                Save public display name
              </SubmitButton>
            </FormActions>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  )
}
