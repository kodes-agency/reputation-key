import { X } from 'lucide-react'
import { FormFieldFrame, errorIdOf } from '#/components/forms/form-field-frame'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import type { StaffDraftRow } from './staff-batch'

export function StaffAddRow({
  row,
  index,
  removable,
  busy,
  onChange,
  onPaste,
  onRemove,
  onRetry,
}: Readonly<{
  row: StaffDraftRow
  index: number
  removable: boolean
  busy: boolean
  onChange: (field: 'displayName' | 'email', text: string) => void
  onPaste: (text: string) => void
  onRemove: () => void
  onRetry: () => void
}>) {
  const locked = busy || row.state !== 'editing'
  const status = {
    editing: null,
    sending: 'Adding…',
    added: 'Added',
    invited: 'Invited',
    failed: row.problem,
  }[row.state]
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
      <legend className="sr-only">Person {index + 1}</legend>
      <div className="flex items-start gap-2">
        <div
          className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2"
          onPaste={(event) => {
            const text = event.clipboardData.getData('text')
            if (!locked && /[\n\t,]/u.test(text)) {
              event.preventDefault()
              onPaste(text)
            }
          }}
        >
          {(['displayName', 'email'] as const).map((field) => {
            const id = `${row.operationId}-${field}`
            return (
              <FormFieldFrame
                key={field}
                id={id}
                label={field === 'email' ? 'Email' : 'Name'}
                invalid={Boolean(row.problem)}
                errors={
                  row.state === 'editing' && row.problem
                    ? [{ message: row.problem }]
                    : undefined
                }
              >
                <Input
                  id={id}
                  type={field === 'email' ? 'email' : 'text'}
                  value={row[field]}
                  maxLength={field === 'email' ? 320 : 100}
                  disabled={locked}
                  aria-invalid={Boolean(row.problem)}
                  aria-describedby={rowProblemId(row, id)}
                  onChange={(event) => onChange(field, event.target.value)}
                />
              </FormFieldFrame>
            )
          })}
        </div>
        {removable && row.state === 'editing' ? (
          <IconButton
            label={`Remove person ${index + 1}`}
            disabled={busy}
            onClick={onRemove}
          >
            <X aria-hidden />
          </IconButton>
        ) : null}
      </div>
      {status ? (
        <p
          id={`${row.operationId}-status`}
          role="status"
          className="text-sm text-muted-foreground"
        >
          {status}
        </p>
      ) : null}
      {row.state === 'failed' ? (
        <Button variant="outline" disabled={busy} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </fieldset>
  )
}

function rowProblemId(row: StaffDraftRow, fieldId: string): string | undefined {
  if (!row.problem) return undefined
  return row.state === 'editing' ? errorIdOf(fieldId) : `${row.operationId}-status`
}
