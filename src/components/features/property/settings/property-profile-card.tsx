import { useForm } from '@tanstack/react-form'
import { CountryCombobox } from '#/components/forms/country-combobox'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { TimezoneCombobox } from '#/components/forms/timezone-combobox'
import type { Action } from '#/components/hooks/use-action'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import { updatePropertyInputSchema } from '#/contexts/property/application/dto/update-property.dto'
import { PROPERTY_COUNTRY_OPTIONS } from './property-profile-options'

const profileFormSchema = updatePropertyInputSchema
  .pick({ name: true, countryCode: true, timezone: true })
  .required()

export type PropertyProfileUpdateAction = Action<
  Readonly<{
    data: Readonly<{
      propertyId: string
      name: string
      countryCode: string
      timezone: string
    }>
  }>
>

type Props = Readonly<{
  property: Readonly<{
    id: string
    name: string
    countryCode: string | null
    timezone: string
    address: string | null
  }>
  canEdit: boolean
  updateProperty: PropertyProfileUpdateAction
}>

/**
 * The facts RepKey keeps about the business itself. Editing country or
 * timezone changes business facts only — it moves no data — so both are
 * ordinary edits. The address comes from Google and is shown, not edited.
 */
export function PropertyProfileCard({ property, canEdit, updateProperty }: Props) {
  const form = useForm({
    defaultValues: {
      name: property.name,
      countryCode: property.countryCode ?? '',
      timezone: property.timezone,
    },
    validators: { onSubmit: profileFormSchema },
    onSubmit: async ({ value }) => {
      await updateProperty({ data: { propertyId: property.id, ...value } })
    },
  })
  const disabled = !canEdit || updateProperty.isPending

  return (
    <form onSubmit={submitHandler(form)}>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Business profile</CardTitle>
          <CardDescription>
            The name your team sees, and where the business is. Changing the country or
            timezone moves no data.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormErrorBanner error={updateProperty.error} />
          <FieldGroup>
            <form.Field name="name">
              {(field: BaseFieldApi) => (
                <FormTextField
                  field={field}
                  id="property-profile-name"
                  label="Workspace name"
                  maxLength={100}
                  disabled={disabled}
                />
              )}
            </form.Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="countryCode">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="property-profile-country">Country</FieldLabel>
                      <CountryCombobox
                        id="property-profile-country"
                        value={field.state.value}
                        countries={PROPERTY_COUNTRY_OPTIONS}
                        disabled={disabled}
                        aria-invalid={invalid}
                        onBlur={field.handleBlur}
                        onValueChange={field.handleChange}
                      />
                      {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="timezone">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="property-profile-timezone">
                        Timezone
                      </FieldLabel>
                      <form.Subscribe selector={(state) => state.values.countryCode}>
                        {(countryCode) => (
                          <TimezoneCombobox
                            id="property-profile-timezone"
                            value={field.state.value}
                            countryCode={countryCode || null}
                            disabled={disabled}
                            aria-invalid={invalid}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                          />
                        )}
                      </form.Subscribe>
                      {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                    </Field>
                  )
                }}
              </form.Field>
            </div>
          </FieldGroup>
          <dl className="grid gap-1 text-sm">
            <dt className="text-muted-foreground">Address · from Google</dt>
            <dd>{property.address ?? 'No address on the Business Profile'}</dd>
          </dl>
          {!canEdit ? (
            <p className="text-sm text-muted-foreground">
              Ask an account admin or a manager of this property to change these details.
            </p>
          ) : null}
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-end border-t">
            <SubmitButton mutation={updateProperty} form={form}>
              Save profile
            </SubmitButton>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  )
}
