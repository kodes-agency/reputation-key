import { CountryCombobox } from '#/components/forms/country-combobox'
import { TimezoneCombobox } from '#/components/forms/timezone-combobox'
import { Badge } from '#/components/ui/badge'
import { Checkbox } from '#/components/ui/checkbox'
import { FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { TableCell, TableRow } from '#/components/ui/table'
import type { GoogleImportReviewFormApi } from './google-import-manager-contract'
import {
  reviewControlId,
  reviewItemIssues,
  timezoneAfterCountryChange,
  type ImportReviewField,
  type ImportReviewItem,
} from './google-import-review-model'
import {
  IMPORT_COUNTRY_OPTIONS,
  importCountryLabel,
} from './google-import-review-options'

type Props = Readonly<{
  form: GoogleImportReviewFormApi
  item: ImportReviewItem
  index: number
  disabled: boolean
}>

const CELL = 'block px-0 py-2 align-top whitespace-normal md:table-cell md:px-3 md:py-3'

function issueId(item: ImportReviewItem, field: ImportReviewField): string {
  return reviewControlId(item.candidateId, `${field}-issue`)
}

/** Live completeness message; not an alert, so a table of flags stays quiet. */
function RowIssue({
  item,
  field,
  message,
}: Readonly<{ item: ImportReviewItem; field: ImportReviewField; message?: string }>) {
  if (!message) return null
  return (
    <p id={issueId(item, field)} className="mt-1.5 text-xs text-destructive">
      {message}
    </p>
  )
}

function CellLabel({
  htmlFor,
  label,
  index,
}: Readonly<{ htmlFor: string; label: string; index: number }>) {
  return (
    <FieldLabel htmlFor={htmlFor} className="mb-1.5 text-muted-foreground md:sr-only">
      {label}
      <span className="sr-only">, row {index + 1}</span>
    </FieldLabel>
  )
}

export function GoogleImportReviewRow({ form, item, index, disabled }: Props) {
  const issues = reviewItemIssues(item)
  const flagged = Object.keys(issues).length > 0
  const editableProfile = item.action === 'create' || item.updateExistingProfile
  const control = (field: ImportReviewField) => ({
    id: reviewControlId(item.candidateId, field),
    'aria-invalid': issues[field] ? true : undefined,
    'aria-describedby': issues[field] ? issueId(item, field) : undefined,
  })

  return (
    <TableRow
      role="row"
      data-flagged={flagged}
      className="block p-4 data-[flagged=true]:bg-destructive/5 data-[flagged=true]:hover:bg-destructive/10 md:table-row md:p-0"
    >
      <TableCell role="cell" className={CELL}>
        <CellLabel htmlFor={control('name').id} label="Property name" index={index} />
        <form.Field name={`items[${index}].name`}>
          {(field) => (
            <Input
              {...control('name')}
              name={field.name}
              value={field.state.value}
              disabled={disabled || !editableProfile}
              maxLength={100}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
            />
          )}
        </form.Field>
        <RowIssue item={item} field="name" message={issues.name} />
        {/* Creating is the normal case; only a relink row works differently. */}
        {item.action === 'relink' || flagged ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.action === 'relink' ? (
              <Badge variant="outline">Link existing</Badge>
            ) : null}
            {flagged ? (
              <span className="text-xs font-medium text-destructive">
                Needs attention
              </span>
            ) : null}
          </div>
        ) : null}
        {item.action === 'relink' ? (
          <form.Field name={`items[${index}].updateExistingProfile`}>
            {(field) => (
              <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-8">
                <Checkbox
                  name={field.name}
                  checked={field.state.value}
                  disabled={disabled}
                  onBlur={field.handleBlur}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                />
                Update name and address
              </label>
            )}
          </form.Field>
        ) : null}
      </TableCell>

      <TableCell role="cell" className={CELL}>
        <CellLabel htmlFor={control('address').id} label="Address" index={index} />
        <form.Field name={`items[${index}].address`}>
          {(field) => (
            <Input
              {...control('address')}
              name={field.name}
              value={field.state.value}
              disabled={disabled || !editableProfile}
              maxLength={500}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
            />
          )}
        </form.Field>
        <RowIssue item={item} field="address" message={issues.address} />
      </TableCell>

      <TableCell role="cell" className={CELL}>
        {item.action === 'create' ? (
          <>
            <CellLabel
              htmlFor={control('countryCode').id}
              label="Country"
              index={index}
            />
            <form.Field name={`items[${index}].countryCode`}>
              {(field) => (
                <CountryCombobox
                  {...control('countryCode')}
                  value={field.state.value}
                  countries={IMPORT_COUNTRY_OPTIONS}
                  disabled={disabled}
                  className="md:min-w-40"
                  onBlur={field.handleBlur}
                  onValueChange={(countryCode) => {
                    field.handleChange(countryCode)
                    form.setFieldValue(
                      `items[${index}].timezone`,
                      timezoneAfterCountryChange(
                        countryCode,
                        form.getFieldValue(`items[${index}].timezone`),
                      ),
                    )
                  }}
                />
              )}
            </form.Field>
            <RowIssue item={item} field="countryCode" message={issues.countryCode} />
          </>
        ) : (
          <>
            <span className="mb-1.5 block text-sm font-medium text-muted-foreground md:sr-only">
              Country
            </span>
            <p className="text-sm md:pt-1.5">
              {item.countryCode ? importCountryLabel(item.countryCode) : 'Not set'}
              <span className="block text-xs text-muted-foreground">
                Kept from the existing property
              </span>
            </p>
          </>
        )}
      </TableCell>

      <TableCell role="cell" className={CELL}>
        <CellLabel htmlFor={control('timezone').id} label="Timezone" index={index} />
        <form.Field name={`items[${index}].timezone`}>
          {(field) => (
            <TimezoneCombobox
              {...control('timezone')}
              value={field.state.value}
              countryCode={item.countryCode}
              disabled={disabled}
              className="md:min-w-48"
              onBlur={field.handleBlur}
              onValueChange={field.handleChange}
            />
          )}
        </form.Field>
        <RowIssue item={item} field="timezone" message={issues.timezone} />
      </TableCell>
    </TableRow>
  )
}
