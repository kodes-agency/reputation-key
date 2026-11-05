// Use the command's note bound and focus the field when it appears.

import { useEffect, useId, useRef } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

type Props = Readonly<{
  note: Readonly<{ open: boolean; text: string; limit: number }>
  pending: boolean
  onOpen: () => void
  onType: (text: string) => void
}>

export function PortalGoalNoteField({ note, pending, onOpen, onType }: Props) {
  const id = useId()
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (note.open) field.current?.focus()
  }, [note.open])
  if (!note.open) {
    return (
      <Button
        type="button"
        variant="link"
        size="inline"
        touch
        className="self-center"
        disabled={pending}
        onClick={onOpen}
      >
        Add a note
      </Button>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Note</Label>
      <Input
        ref={field}
        id={id}
        value={note.text}
        maxLength={note.limit}
        disabled={pending}
        onChange={(event) => onType(event.target.value)}
      />
    </div>
  )
}
