import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { FormWithField } from '#/components/forms/form-with-field'

type OrgBillingFormValues = {
  billingCompanyName: string
  billingAddress: string
  billingCity: string
  billingPostalCode: string
  billingCountry: string
  name: string
  slug: string
  contactEmail: string
}

type Props = Readonly<{
  form: FormWithField<OrgBillingFormValues>
}>

export function OrgBillingCard({ form }: Props) {
  return (
    <FieldGroup>
      <form.Field name="billingCompanyName">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="Company name"
            id="billing-company-name"
            placeholder="Acme Inc."
            autoComplete="organization"
          />
        )}
      </form.Field>

      <form.Field name="billingAddress">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="Address"
            id="billing-address"
            placeholder="123 Main St"
            autoComplete="street-address"
          />
        )}
      </form.Field>

      <form.Field name="billingCity">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="City"
            id="billing-city"
            placeholder="San Francisco"
            autoComplete="address-level2"
          />
        )}
      </form.Field>

      <form.Field name="billingPostalCode">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="Postal code"
            id="billing-postal-code"
            placeholder="94102"
            autoComplete="postal-code"
          />
        )}
      </form.Field>

      <form.Field name="billingCountry">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="Country"
            id="billing-country"
            placeholder="United States"
            autoComplete="country-name"
          />
        )}
      </form.Field>
    </FieldGroup>
  )
}
