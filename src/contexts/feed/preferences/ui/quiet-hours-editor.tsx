import { useId, useState } from 'react'
import { FormActions } from '#/components/forms/form-actions'
import { Button } from '#/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'

export function QuietHoursEditor({
  start,
  end,
  categoryLabel,
  disabled = false,
  onSave,
}: Readonly<{
  /** The window as saved: what Reset puts back. */
  start: string | null
  end: string | null
  /** Named in every control, since each category row has its own editor. */
  categoryLabel: string
  /** Set when email delivery is unavailable for the selected property. */
  disabled?: boolean
  /** Rejects with the refusal, which the editor shows above its actions. */
  onSave: (start: string | null, end: string | null) => Promise<void>
}>) {
  const [nextStart, setNextStart] = useState(start ?? '')
  const [nextEnd, setNextEnd] = useState(end ?? '')
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState<unknown>(null)
  const startId = useId()
  const endId = useId()
  const sameTimesHintId = useId()
  // One end of a range without the other is not a saveable window, and equal
  // ends are no window at all: delivery would never hold anything back.
  const halfOpen = (nextStart === '') !== (nextEnd === '')
  const sameTimes = nextStart !== '' && nextStart === nextEnd
  const dirty = nextStart !== (start ?? '') || nextEnd !== (end ?? '')

  const save = async () => {
    setRefusal(null)
    setSaving(true)
    try {
      await onSave(nextStart || null, nextEnd || null)
    } catch (error) {
      setRefusal(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor={startId}>Quiet from</FieldLabel>
          <Input
            id={startId}
            className="w-32 min-w-0"
            type="time"
            aria-label={`${categoryLabel}: Quiet from`}
            value={nextStart}
            disabled={disabled}
            onChange={(event) => setNextStart(event.target.value)}
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor={endId}>until</FieldLabel>
          <Input
            id={endId}
            className="w-32 min-w-0"
            type="time"
            aria-label={`${categoryLabel}: quiet hours until`}
            value={nextEnd}
            disabled={disabled}
            onChange={(event) => setNextEnd(event.target.value)}
          />
        </Field>
      </div>
      {sameTimes ? (
        <FieldDescription id={sameTimesHintId}>
          Choose different start and end times.
        </FieldDescription>
      ) : null}
      <FormActions
        dirty={dirty}
        onReset={() => {
          setNextStart(start ?? '')
          setNextEnd(end ?? '')
        }}
        error={refusal}
        pending={saving}
      >
        <Button
          type="button"
          pending={saving}
          aria-label={`Save quiet hours for ${categoryLabel}`}
          aria-describedby={sameTimes ? sameTimesHintId : undefined}
          disabled={disabled || halfOpen || sameTimes}
          onClick={() => void save()}
        >
          Save quiet hours
        </Button>
      </FormActions>
    </div>
  )
}
