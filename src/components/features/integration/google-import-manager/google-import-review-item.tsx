import { Checkbox } from '#/components/ui/checkbox'
import type {
  ImportReviewItem,
  ImportReviewValidation,
} from './google-import-review-model'
import { GoogleImportReviewFields } from './google-import-review-fields'

type Props = Readonly<{
  item: ImportReviewItem
  index: number
  total: number
  attempted: boolean
  validation: ImportReviewValidation
  onChange: (item: ImportReviewItem) => void
}>

export function GoogleImportReviewItem({
  item,
  index,
  total,
  attempted,
  validation,
  onChange,
}: Props) {
  const patch = (next: Partial<ImportReviewItem>) => onChange({ ...item, ...next })

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
        <label className="mb-5 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
          <Checkbox
            checked={item.updateExistingProfile}
            onCheckedChange={(checked) =>
              patch({ updateExistingProfile: checked === true })
            }
          />
          Update the existing property name and address from this review
        </label>
      ) : null}

      <GoogleImportReviewFields
        item={item}
        attempted={attempted}
        validation={validation}
        onPatch={patch}
      />
    </section>
  )
}
