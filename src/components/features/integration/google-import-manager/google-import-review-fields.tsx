import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type {
  ImportReviewItem,
  ImportReviewValidation,
} from './google-import-review-model'
import { reviewControlId } from './google-import-review-model'
import {
  IMPORT_COUNTRY_OPTIONS,
  IMPORT_TIMEZONE_OPTIONS,
} from './google-import-review-options'

type Props = Readonly<{
  item: ImportReviewItem
  attempted: boolean
  validation: ImportReviewValidation
  onPatch: (patch: Partial<ImportReviewItem>) => void
}>

function errorFor(
  validation: ImportReviewValidation,
  item: ImportReviewItem,
  field: string,
): string | undefined {
  return validation.errors[`${item.candidateId}.${field}`]
}

export function GoogleImportReviewFields({
  item,
  attempted,
  validation,
  onPatch,
}: Props) {
  const editableProfile = item.action === 'create' || item.updateExistingProfile
  const invalid = (field: string) => attempted && !!errorFor(validation, item, field)

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={invalid('name')}>
          <FieldLabel htmlFor={reviewControlId(item.candidateId, 'name')}>
            Property name
          </FieldLabel>
          <Input
            id={reviewControlId(item.candidateId, 'name')}
            value={item.name}
            disabled={!editableProfile}
            maxLength={100}
            aria-invalid={invalid('name')}
            onChange={(event) => onPatch({ name: event.currentTarget.value })}
          />
          {attempted ? (
            <FieldError>{errorFor(validation, item, 'name')}</FieldError>
          ) : null}
        </Field>

        <Field data-invalid={invalid('address')}>
          <FieldLabel htmlFor={reviewControlId(item.candidateId, 'address')}>
            Address
          </FieldLabel>
          <Input
            id={reviewControlId(item.candidateId, 'address')}
            value={item.address}
            disabled={!editableProfile}
            maxLength={500}
            aria-invalid={invalid('address')}
            onChange={(event) => onPatch({ address: event.currentTarget.value })}
          />
          {attempted ? (
            <FieldError>{errorFor(validation, item, 'address')}</FieldError>
          ) : null}
        </Field>

        {item.action === 'create' ? (
          <Field data-invalid={invalid('countryCode')}>
            <FieldLabel htmlFor={reviewControlId(item.candidateId, 'countryCode')}>
              Country
            </FieldLabel>
            <Select
              value={item.countryCode}
              onValueChange={(countryCode) =>
                onPatch({ countryCode, countryConfirmed: false })
              }
            >
              <SelectTrigger
                id={reviewControlId(item.candidateId, 'countryCode')}
                className="w-full"
                aria-invalid={invalid('countryCode')}
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
            {attempted ? (
              <FieldError>{errorFor(validation, item, 'countryCode')}</FieldError>
            ) : null}
          </Field>
        ) : null}

        <Field data-invalid={invalid('timezone')}>
          <FieldLabel htmlFor={reviewControlId(item.candidateId, 'timezone')}>
            Timezone
          </FieldLabel>
          <Select
            value={item.timezone}
            onValueChange={(timezone) => onPatch({ timezone, timezoneConfirmed: false })}
          >
            <SelectTrigger
              id={reviewControlId(item.candidateId, 'timezone')}
              className="w-full"
              aria-invalid={invalid('timezone')}
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
          {attempted ? (
            <FieldError>{errorFor(validation, item, 'timezone')}</FieldError>
          ) : null}
        </Field>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {item.action === 'create' ? (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
            <Checkbox
              id={reviewControlId(item.candidateId, 'countryConfirmed')}
              checked={item.countryConfirmed}
              aria-invalid={invalid('countryConfirmed')}
              onCheckedChange={(checked) =>
                onPatch({ countryConfirmed: checked === true })
              }
            />
            <span>
              Confirm {item.countryCode || 'the selected country'}
              {attempted ? (
                <FieldError>{errorFor(validation, item, 'countryConfirmed')}</FieldError>
              ) : null}
            </span>
          </label>
        ) : (
          <div />
        )}
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
          <Checkbox
            id={reviewControlId(item.candidateId, 'timezoneConfirmed')}
            checked={item.timezoneConfirmed}
            aria-invalid={invalid('timezoneConfirmed')}
            onCheckedChange={(checked) =>
              onPatch({ timezoneConfirmed: checked === true })
            }
          />
          <span>
            Confirm {item.timezone || 'the selected timezone'}
            {attempted ? (
              <FieldError>{errorFor(validation, item, 'timezoneConfirmed')}</FieldError>
            ) : null}
          </span>
        </label>
      </div>
    </>
  )
}
