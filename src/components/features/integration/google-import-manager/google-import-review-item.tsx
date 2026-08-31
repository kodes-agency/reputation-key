import { Checkbox } from '#/components/ui/checkbox'
import type { ImportReviewItem } from './google-import-review-model'
import { GoogleImportReviewFields } from './google-import-review-fields'
import type { GoogleImportReviewFormApi } from './use-google-import-review-form'

type Props = Readonly<{
  form: GoogleImportReviewFormApi
  item: ImportReviewItem
  index: number
  total: number
  attempted: boolean
  disabled: boolean
}>

export function GoogleImportReviewItem({
  form,
  item,
  index,
  total,
  attempted,
  disabled,
}: Props) {
  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-xs sm:p-5"
      aria-labelledby={`import-review-heading-${item.candidateId}`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Property {index + 1} of {total}
          </p>
          <h3
            id={`import-review-heading-${item.candidateId}`}
            className="mt-1 font-semibold"
          >
            {item.name || 'Unnamed property'}
          </h3>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
          {item.action === 'relink' ? 'Link existing' : 'Create new'}
        </span>
      </div>

      {item.action === 'relink' ? (
        <form.Field name={`items[${index}].updateExistingProfile`}>
          {(field) => (
            <label className="mb-5 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
              <Checkbox
                name={field.name}
                checked={field.state.value}
                disabled={disabled}
                onBlur={field.handleBlur}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
              />
              Update the existing property name and address from this review
            </label>
          )}
        </form.Field>
      ) : null}

      <GoogleImportReviewFields
        form={form}
        item={item}
        index={index}
        attempted={attempted}
        disabled={disabled}
      />
    </section>
  )
}
