// A colour as the page edits it: the browser's colour picker as a swatch, and
// the hex digits beside it. Six digits commit as they are typed; a short form
// (#rgb) commits when the field is left, and anything else goes back to the
// colour that stands.
import { useId, useState } from 'react'
import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { Input } from '#/components/ui/input'
import { parseColourInput } from './property-look-rules'

const SIX_DIGITS = /^#?[0-9a-f]{6}$/iu

type Props = Readonly<{
  label: string
  value: string
  onCommit: (colour: string) => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}>

export function PropertyLookColourField({
  label,
  value,
  onCommit,
  disabled = false,
  invalid = false,
  describedBy,
}: Props) {
  const id = useId()
  // null: show the colour that stands.
  const [typed, setTyped] = useState<string | null>(null)
  const commit = (colour: string) => {
    setTyped(null)
    onCommit(colour)
  }
  return (
    <FormFieldFrame id={id} label={label} invalid={invalid} className="gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}, colour picker`}
          value={value.toLowerCase()}
          disabled={disabled}
          onChange={(event) => commit(event.target.value.toUpperCase())}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={id}
          value={typed ?? value}
          disabled={disabled}
          maxLength={7}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="font-mono uppercase"
          onChange={(event) => {
            const text = event.target.value
            if (SIX_DIGITS.test(text.trim())) {
              const colour = parseColourInput(text)
              if (colour !== null) return commit(colour)
            }
            setTyped(text)
          }}
          onBlur={() => {
            const colour = typed === null ? null : parseColourInput(typed)
            if (colour === null) setTyped(null)
            else commit(colour)
          }}
        />
      </div>
    </FormFieldFrame>
  )
}
