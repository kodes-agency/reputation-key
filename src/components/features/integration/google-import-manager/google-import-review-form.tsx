import { useState } from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { submitForm } from '#/components/forms/form-submit'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { TimezoneCombobox } from '#/components/forms/timezone-combobox'
import { Field, FieldLabel } from '#/components/ui/field'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import type { GoogleImportReviewFormApi } from './google-import-manager-contract'
import { applyBulkTimezone, countFlaggedReviewItems } from './google-import-review-model'
import { GoogleImportReviewRow } from './google-import-review-row'

type Props = Readonly<{
  form: GoogleImportReviewFormApi
  onBack: () => void
  isSubmitting: boolean
  submitError: string | null
}>

const ACKNOWLEDGEMENT_ID = 'import-profile-acknowledged'
const BLOCKED_REASON_ID = 'import-start-blocked-reason'

function attentionSummary(total: number, flagged: number): string {
  const properties = `${total} ${total === 1 ? 'property' : 'properties'}`
  if (flagged === 0) return `${properties} ready to import`
  return `${flagged} of ${properties} ${flagged === 1 ? 'needs' : 'need'} attention`
}

function BulkTimezone({
  form,
  disabled,
}: Readonly<{ form: GoogleImportReviewFormApi; disabled: boolean }>) {
  const [timezone, setTimezone] = useState('')
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-end sm:justify-between">
      <Field className="max-w-md">
        <FieldLabel htmlFor="import-bulk-timezone">Timezone for all rows</FieldLabel>
        <TimezoneCombobox
          id="import-bulk-timezone"
          value={timezone}
          onValueChange={setTimezone}
          disabled={disabled}
          className="bg-background"
        />
      </Field>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !timezone}
        onClick={() => {
          const next = applyBulkTimezone(form.state.values, timezone)
          form.setFieldValue('items', next.items)
          form.setFieldValue('profileAcknowledged', next.profileAcknowledged)
        }}
      >
        Apply to all
      </Button>
    </div>
  )
}

export function GoogleImportReviewForm({
  form,
  onBack,
  isSubmitting,
  submitError,
}: Props) {
  return (
    <form
      className="space-y-6"
      aria-busy={isSubmitting}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void submitForm(form)
      }}
    >
      <form.Subscribe
        selector={(state) => [state.values.items, state.submissionAttempts] as const}
      >
        {([items, submissionAttempts]) => {
          const flaggedCount = countFlaggedReviewItems(items)
          return (
            <>
              <section aria-labelledby="import-review-heading" className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="max-w-2xl">
                    <h3 id="import-review-heading" className="text-lg font-semibold">
                      Confirm details
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Each property is created or linked exactly as shown. Where a country
                      spans several timezones, choose the one the business runs on.
                    </p>
                  </div>
                  <p
                    className="text-sm font-medium data-[flagged=true]:text-destructive"
                    data-flagged={flaggedCount > 0}
                    role="status"
                  >
                    {attentionSummary(items.length, flaggedCount)}
                  </p>
                </div>

                {items.length > 1 ? (
                  <BulkTimezone form={form} disabled={isSubmitting} />
                ) : null}

                <div className="overflow-hidden rounded-xl border bg-card">
                  {/* Below md the table reflows into one block per property. Explicit
                      roles keep the table, row and cell semantics that a changed CSS
                      display would otherwise drop from the accessibility tree. */}
                  <Table
                    role="table"
                    aria-labelledby="import-review-heading"
                    className="block md:table"
                  >
                    <TableHeader role="rowgroup" className="hidden md:table-header-group">
                      <TableRow role="row" className="hover:bg-transparent">
                        <TableHead role="columnheader" className="px-3 md:w-[28%]">
                          Property name
                        </TableHead>
                        <TableHead role="columnheader" className="px-3 md:w-[30%]">
                          Address
                        </TableHead>
                        <TableHead role="columnheader" className="px-3">
                          Country
                        </TableHead>
                        <TableHead role="columnheader" className="px-3">
                          Timezone
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody role="rowgroup" className="block md:table-row-group">
                      {items.map((item, index) => (
                        <GoogleImportReviewRow
                          key={item.candidateId}
                          form={form}
                          item={item}
                          index={index}
                          disabled={isSubmitting}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              {submitError ? (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>Import could not start</AlertTitle>
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              ) : null}

              <section
                aria-labelledby="google-import-next-steps-title"
                className="rounded-xl border bg-muted/40 p-4 text-sm"
              >
                <h3 id="google-import-next-steps-title" className="font-medium">
                  What happens after you start
                </h3>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>
                    Each property is created and its Google reviews are imported into the
                    inbox. You can watch the progress and leave the page at any time.
                  </li>
                  <li>
                    You then answer three questions once for every property: its reply
                    language, who is responsible for it, and whether RepKey may use AI.
                    Nothing is sent to the AI provider until you agree to the notice;
                    anything you skip stays on the property&apos;s setup checklist.
                  </li>
                </ol>
              </section>

              <form.Field name="profileAcknowledged">
                {(field) => {
                  const missing = submissionAttempts > 0 && !field.state.value
                  return (
                    <Field
                      orientation="horizontal"
                      data-invalid={missing}
                      className="items-start rounded-lg border p-4"
                    >
                      <Checkbox
                        id={ACKNOWLEDGEMENT_ID}
                        name={field.name}
                        checked={field.state.value}
                        disabled={isSubmitting}
                        aria-invalid={missing || undefined}
                        aria-describedby={`${ACKNOWLEDGEMENT_ID}-description`}
                        className="mt-0.5"
                        onBlur={field.handleBlur}
                        onCheckedChange={(checked) =>
                          field.handleChange(checked === true)
                        }
                      />
                      <div className="space-y-1">
                        <FieldLabel htmlFor={ACKNOWLEDGEMENT_ID}>
                          I have checked these details
                        </FieldLabel>
                        <p
                          id={`${ACKNOWLEDGEMENT_ID}-description`}
                          className="text-sm text-muted-foreground"
                        >
                          RepKey records your confirmation of every name, address, country
                          and timezone above when the import starts.
                        </p>
                        {missing ? (
                          <p role="alert" className="text-sm text-destructive">
                            Confirm that you have checked these details.
                          </p>
                        ) : null}
                      </div>
                    </Field>
                  )
                }}
              </form.Field>

              <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onBack}
                  disabled={isSubmitting}
                >
                  Back to locations
                </Button>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {flaggedCount > 0 ? (
                    <p id={BLOCKED_REASON_ID} className="text-sm text-muted-foreground">
                      Fix the flagged {flaggedCount === 1 ? 'row' : 'rows'} to start the
                      import.
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    disabled={isSubmitting || flaggedCount > 0}
                    aria-describedby={flaggedCount > 0 ? BLOCKED_REASON_ID : undefined}
                  >
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
              </div>
            </>
          )
        }}
      </form.Subscribe>
    </form>
  )
}
