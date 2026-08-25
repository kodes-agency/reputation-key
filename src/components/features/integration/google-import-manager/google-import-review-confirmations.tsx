import { Checkbox } from '#/components/ui/checkbox'
import { FieldError } from '#/components/ui/field'
import type { ImportReviewItem } from './google-import-review-model'
import { reviewControlId } from './google-import-review-model'
import type { GoogleImportReviewFormApi } from './use-google-import-review-form'

type Props = Readonly<{
  form: GoogleImportReviewFormApi
  item: ImportReviewItem
  index: number
  attempted: boolean
  disabled: boolean
}>

export function GoogleImportReviewConfirmations({
  form,
  item,
  index,
  attempted,
  disabled,
}: Props) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {item.action === 'create' ? (
        <form.Field name={`items[${index}].countryConfirmed`}>
          {(field) => {
            const invalid = attempted && !field.state.meta.isValid
            return (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                <Checkbox
                  id={reviewControlId(item.candidateId, 'countryConfirmed')}
                  name={field.name}
                  checked={field.state.value}
                  disabled={disabled}
                  aria-invalid={invalid}
                  onBlur={field.handleBlur}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                />
                <span>
                  Confirm {item.countryCode || 'the selected country'}
                  {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                </span>
              </label>
            )
          }}
        </form.Field>
      ) : (
        <div />
      )}
      <form.Field name={`items[${index}].timezoneConfirmed`}>
        {(field) => {
          const invalid = attempted && !field.state.meta.isValid
          return (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
              <Checkbox
                id={reviewControlId(item.candidateId, 'timezoneConfirmed')}
                name={field.name}
                checked={field.state.value}
                disabled={disabled}
                aria-invalid={invalid}
                onBlur={field.handleBlur}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
              />
              <span>
                Confirm {item.timezone || 'the selected timezone'}
                {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
              </span>
            </label>
          )
        }}
      </form.Field>
    </div>
  )
}
