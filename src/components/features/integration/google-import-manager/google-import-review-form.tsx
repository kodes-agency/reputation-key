import { useMemo, useState } from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { ImportReviewDraft, ImportReviewItem } from './google-import-review-model'
import {
  applyBulkTimezone,
  validateImportReviewDraft,
} from './google-import-review-model'
import { GoogleImportReviewItem } from './google-import-review-item'
import { IMPORT_TIMEZONE_OPTIONS } from './google-import-review-options'

type Props = Readonly<{
  draft: ImportReviewDraft
  onChange: (draft: ImportReviewDraft) => void
  onBack: () => void
  onSubmit: () => void
  isSubmitting: boolean
  submitError: string | null
}>

export function GoogleImportReviewForm({
  draft,
  onChange,
  onBack,
  onSubmit,
  isSubmitting,
  submitError,
}: Props) {
  const [attempted, setAttempted] = useState(false)
  const [bulkTimezone, setBulkTimezone] = useState('')
  const validation = useMemo(() => validateImportReviewDraft(draft), [draft])
  const updateItem = (index: number, item: ImportReviewItem) => {
    onChange({
      items: draft.items.map((current, itemIndex) =>
        itemIndex === index ? item : current,
      ),
    })
  }
  const submit = () => {
    setAttempted(true)
    if (!validation.valid) {
      if (validation.firstInvalidControlId) {
        document.getElementById(validation.firstInvalidControlId)?.focus()
      }
      return
    }
    onSubmit()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-end sm:justify-between">
        <Field className="max-w-md">
          <FieldLabel htmlFor="import-bulk-timezone">Timezone for all rows</FieldLabel>
          <Select value={bulkTimezone} onValueChange={setBulkTimezone}>
            <SelectTrigger id="import-bulk-timezone" className="w-full bg-background">
              <SelectValue placeholder="Choose a timezone" />
            </SelectTrigger>
            <SelectContent>
              {IMPORT_TIMEZONE_OPTIONS.map((timezone) => (
                <SelectItem key={timezone} value={timezone}>
                  {timezone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={!bulkTimezone}
          onClick={() => onChange(applyBulkTimezone(draft, bulkTimezone))}
        >
          Apply to all
        </Button>
      </div>

      {attempted && !validation.valid ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Review required fields</AlertTitle>
          <AlertDescription>
            Confirm every suggested country and timezone before starting the import.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-4">
        {draft.items.map((item, index) => (
          <GoogleImportReviewItem
            key={item.candidateId}
            item={item}
            index={index}
            total={draft.items.length}
            attempted={attempted}
            validation={validation}
            onChange={(next) => updateItem(index, next)}
          />
        ))}
      </div>

      {submitError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Import could not start</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          Back to locations
        </Button>
        <Button type="button" onClick={submit} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Starting import…
            </>
          ) : (
            <>
              <Check aria-hidden="true" />
              Start import
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
