import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export function QuietHoursEditor({
  start,
  end,
  onSave,
}: Readonly<{
  start: string | null
  end: string | null
  onSave: (start: string | null, end: string | null) => void
}>) {
  const [nextStart, setNextStart] = useState(start ?? '')
  const [nextEnd, setNextEnd] = useState(end ?? '')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label>
        Quiet from
        <Input
          className="w-32"
          type="time"
          value={nextStart}
          onChange={(event) => setNextStart(event.target.value)}
        />
      </Label>
      <Label>
        until
        <Input
          className="w-32"
          type="time"
          value={nextEnd}
          onChange={(event) => setNextEnd(event.target.value)}
        />
      </Label>
      <button
        type="button"
        className="rounded-md border px-3 py-2 text-sm"
        disabled={(nextStart === '') !== (nextEnd === '')}
        onClick={() => onSave(nextStart || null, nextEnd || null)}
      >
        Save quiet hours
      </button>
    </div>
  )
}
