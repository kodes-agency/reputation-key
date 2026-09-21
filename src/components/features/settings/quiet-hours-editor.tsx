import { useId, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export function QuietHoursEditor({
  start,
  end,
  categoryLabel,
  disabled = false,
  onSave,
}: Readonly<{
  start: string | null
  end: string | null
  /** Named in every control, since each category row has its own editor. */
  categoryLabel: string
  /** Set when email delivery is unavailable for the selected property. */
  disabled?: boolean
  onSave: (start: string | null, end: string | null) => void
}>) {
  const [nextStart, setNextStart] = useState(start ?? '')
  const [nextEnd, setNextEnd] = useState(end ?? '')
  const sameTimesHintId = useId()
  // One end of a range without the other is not a saveable window, and equal
  // ends are no window at all: delivery would never hold anything back.
  const halfOpen = (nextStart === '') !== (nextEnd === '')
  const sameTimes = nextStart !== '' && nextStart === nextEnd
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Label>
        Quiet from
        <Input
          className="w-32 min-w-0"
          type="time"
          aria-label={`${categoryLabel}: Quiet from`}
          value={nextStart}
          disabled={disabled}
          onChange={(event) => setNextStart(event.target.value)}
        />
      </Label>
      <Label>
        until
        <Input
          className="w-32 min-w-0"
          type="time"
          aria-label={`${categoryLabel}: quiet hours until`}
          value={nextEnd}
          disabled={disabled}
          onChange={(event) => setNextEnd(event.target.value)}
        />
      </Label>
      <Button
        type="button"
        variant="outline"
        aria-label={`Save quiet hours for ${categoryLabel}`}
        aria-describedby={sameTimes ? sameTimesHintId : undefined}
        disabled={disabled || halfOpen || sameTimes}
        onClick={() => onSave(nextStart || null, nextEnd || null)}
      >
        Save quiet hours
      </Button>
      {sameTimes ? (
        <p id={sameTimesHintId} className="basis-full text-sm text-muted-foreground">
          Choose different start and end times.
        </p>
      ) : null}
    </div>
  )
}
