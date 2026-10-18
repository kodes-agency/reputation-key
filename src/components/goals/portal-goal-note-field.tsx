// S-19: "Add a note", then the field "Note", which takes the focus as it
// appears; bounded as the Program commands bound a change's note. The change
// sheets' (the Monthly portal goal's and a goal's own, PLAN PG-14, PG-21).
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
        className="self-start"
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
