import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export function QuietHoursEditor({
  start,
  end,
  disabled = false,
  onSave,
}: Readonly<{
  start: string | null
  end: string | null
  /** Set when email delivery is unavailable for the selected property. */
  disabled?: boolean
  onSave: (start: string | null, end: string | null) => void
}>) {
  const [nextStart, setNextStart] = useState(start ?? '')
  const [nextEnd, setNextEnd] = useState(end ?? '')
  // One end of a range without the other is not a saveable window.
  const halfOpen = (nextStart === '') !== (nextEnd === '')
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Label>
        Quiet from
        <Input
          className="w-32 min-w-0"
          type="time"
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
          value={nextEnd}
          disabled={disabled}
          onChange={(event) => setNextEnd(event.target.value)}
        />
      </Label>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || halfOpen}
        onClick={() => onSave(nextStart || null, nextEnd || null)}
      >
        Save quiet hours
      </Button>
    </div>
  )
}
