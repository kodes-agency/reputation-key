import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { ImportReviewItem } from './google-import-review-model'
import { reviewControlId } from './google-import-review-model'
import { GoogleImportReviewConfirmations } from './google-import-review-confirmations'
import {
  IMPORT_COUNTRY_OPTIONS,
  IMPORT_TIMEZONE_OPTIONS,
} from './google-import-review-options'
import type { GoogleImportReviewFormApi } from './use-google-import-review-form'

type Props = Readonly<{
  form: GoogleImportReviewFormApi
  item: ImportReviewItem
  index: number
  attempted: boolean
  disabled: boolean
}>

export function GoogleImportReviewFields({
  form,
  item,
  index,
  attempted,
  disabled,
}: Props) {
  const editableProfile = item.action === 'create' || item.updateExistingProfile

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name={`items[${index}].name`}>
          {(field) => {
            const invalid = attempted && !field.state.meta.isValid
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor={reviewControlId(item.candidateId, 'name')}>
                  Property name
                </FieldLabel>
                <Input
                  id={reviewControlId(item.candidateId, 'name')}
                  name={field.name}
                  value={field.state.value}
                  disabled={disabled || !editableProfile}
                  maxLength={100}
                  aria-invalid={invalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                />
                {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name={`items[${index}].address`}>
          {(field) => {
            const invalid = attempted && !field.state.meta.isValid
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor={reviewControlId(item.candidateId, 'address')}>
                  Address
                </FieldLabel>
                <Input
                  id={reviewControlId(item.candidateId, 'address')}
                  name={field.name}
                  value={field.state.value}
                  disabled={disabled || !editableProfile}
                  maxLength={500}
                  aria-invalid={invalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                />
                {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
              </Field>
            )
          }}
        </form.Field>

        {item.action === 'create' ? (
          <form.Field name={`items[${index}].countryCode`}>
            {(field) => {
              const invalid = attempted && !field.state.meta.isValid
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor={reviewControlId(item.candidateId, 'countryCode')}>
                    Country
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(countryCode) => {
                      field.handleChange(countryCode)
                      form.setFieldValue(`items[${index}].countryConfirmed`, false)
                    }}
                    disabled={disabled}
                  >
                    <SelectTrigger
                      id={reviewControlId(item.candidateId, 'countryCode')}
                      className="w-full"
                      aria-invalid={invalid}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {IMPORT_COUNTRY_OPTIONS.map((country) => (
                        <SelectItem key={country.code} value={country.code}>
                          {country.label} ({country.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                </Field>
              )
            }}
          </form.Field>
        ) : null}

        <form.Field name={`items[${index}].timezone`}>
          {(field) => {
            const invalid = attempted && !field.state.meta.isValid
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor={reviewControlId(item.candidateId, 'timezone')}>
                  Timezone
                </FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(timezone) => {
                    field.handleChange(timezone)
                    form.setFieldValue(`items[${index}].timezoneConfirmed`, false)
                  }}
                  disabled={disabled}
                >
                  <SelectTrigger
                    id={reviewControlId(item.candidateId, 'timezone')}
                    className="w-full"
                    aria-invalid={invalid}
                    onBlur={field.handleBlur}
                  >
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPORT_TIMEZONE_OPTIONS.map((timezone) => (
                      <SelectItem key={timezone} value={timezone}>
                        {timezone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
              </Field>
            )
          }}
        </form.Field>
      </div>

      <GoogleImportReviewConfirmations
        form={form}
        item={item}
        index={index}
        attempted={attempted}
        disabled={disabled}
      />
    </>
  )
}
