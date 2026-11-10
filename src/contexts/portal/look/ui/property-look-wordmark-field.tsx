// The wordmark's field (board 09, "Name and logo"): the short name at the top of
// a guest page until a logo replaces it. Shared by the Property look page and a
// portal's own name and logo, which differ only in what the hint says and in the
// DOM id (`id`), so two of them on one page never share one.
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import { Input } from '#/components/ui/input'
import { WORDMARK_MAX } from './property-look-rules'

type Props = Readonly<{
  id: string
  value: string
  onChange: (wordmark: string) => void
  disabled: boolean
  /** Under the field while the wordmark fits; the reason takes its place when it does not. */
  hint: string
}>

export function PropertyLookWordmarkField({
  id,
  value,
  onChange,
  disabled,
  hint,
}: Props) {
  const tooLong = value.trim().length > WORDMARK_MAX
  // The reason takes the hint's place, and the control names whichever is showing.
  const description = tooLong ? undefined : hint
  return (
    <FormFieldFrame
      id={id}
      label="Wordmark"
      description={description}
      invalid={tooLong}
      errors={tooLong ? [{ message: `At most ${WORDMARK_MAX} characters` }] : undefined}
      className="gap-1.5"
    >
      <Input
        id={id}
        value={value}
        disabled={disabled}
        autoComplete="off"
        aria-invalid={tooLong}
        aria-describedby={describedByOf(id, description, tooLong)}
        className="uppercase tracking-[0.2em]"
        onChange={(event) => onChange(event.target.value)}
      />
    </FormFieldFrame>
  )
}
