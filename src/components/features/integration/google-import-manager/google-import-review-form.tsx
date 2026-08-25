import { useState } from 'react'
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
import { applyBulkTimezone } from './google-import-review-model'
import { GoogleImportReviewItem } from './google-import-review-item'
import { IMPORT_TIMEZONE_OPTIONS } from './google-import-review-options'
import type { GoogleImportReviewFormApi } from './use-google-import-review-form'

type Props = Readonly<{
  form: GoogleImportReviewFormApi
  onBack: () => void
  isSubmitting: boolean
  submitError: string | null
}>

export function GoogleImportReviewForm({
  form,
  onBack,
  isSubmitting,
  submitError,
}: Props) {
  const [bulkTimezone, setBulkTimezone] = useState('')

  return (
    <form
      className="space-y-6"
      aria-busy={isSubmitting}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-end sm:justify-between">
        <Field className="max-w-md">
          <FieldLabel htmlFor="import-bulk-timezone">Timezone for all rows</FieldLabel>
          <Select
            value={bulkTimezone}
            onValueChange={setBulkTimezone}
            disabled={isSubmitting}
          >
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
          disabled={isSubmitting || !bulkTimezone}
          onClick={() => {
            const next = applyBulkTimezone(
              { items: form.state.values.items },
              bulkTimezone,
            )
            form.setFieldValue('items', next.items)
          }}
        >
          Apply to all
        </Button>
      </div>

      <form.Subscribe
        selector={(state) =>
          [state.values.items, state.submissionAttempts, state.isValid] as const
        }
      >
        {([items, submissionAttempts, isValid]) => (
          <>
            {submissionAttempts > 0 && !isValid ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertTitle>Review required fields</AlertTitle>
                <AlertDescription>
                  Confirm every suggested country and timezone before starting the import.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-4">
              {items.map((item, index) => (
                <GoogleImportReviewItem
                  key={item.candidateId}
                  form={form}
                  item={item}
                  index={index}
                  total={items.length}
                  attempted={submissionAttempts > 0}
                  disabled={isSubmitting}
                />
              ))}
            </div>
          </>
        )}
      </form.Subscribe>

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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
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
    </form>
  )
}
