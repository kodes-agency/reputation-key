// The checkbox of a single framed confirmation (UI consistency scan: FORM-11): a
// statement the person agrees to or confirms ("I have read this notice and agree...",
// "I have checked these details", "This property owns this photo..."), or one framed
// yes that stands for a whole list ("Select all current portals", which is a choice and
// not an agreement). One frame, so the same sentence looks the same on the settings
// page, in the setup wizard and in an import: a Field holding the checkbox beside its
// sentence, what the sentence lists (when it ends in one) under it, a line of help
// under that and the refusal last. A setting
// that is simply on or off is a `SettingSwitchRow`, and the rows of a list of things to
// choose from keep plain `Checkbox` rows.
import type { ReactNode } from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/components/ui/field'
import { cn } from '#/lib/utils'
import { describedByOf, descriptionIdOf, errorIdOf } from './form-field-frame'

/** The id of what the sentence lists, which the checkbox names first in `aria-describedby`. */
const detailsIdOf = (id: string): string => `${id}-details`

type Props = Readonly<{
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** The sentence the person agrees to or confirms: the checkbox's name. */
  children: ReactNode
  /**
   * What a sentence ending in a list names, such as every Property one consent
   * covers. A label holds phrasing content only, so the list is drawn under the
   * sentence, inside the frame, and read first in the checkbox's description.
   */
  details?: ReactNode
  /** A line under the sentence: what recording the answer means. */
  description?: ReactNode
  /** Why the box has to be ticked, once the person has tried to go on without it. */
  error?: ReactNode
  disabled?: boolean
  name?: string
  onBlur?: () => void
  className?: string
}>

export function ConsentCheckbox({
  id,
  checked,
  onCheckedChange,
  children,
  details,
  description,
  error,
  disabled = false,
  name,
  onBlur,
  className,
}: Props) {
  const invalid = Boolean(error)
  const describedBy =
    [details ? detailsIdOf(id) : undefined, describedByOf(id, description, invalid)]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <Field
      data-slot="consent-checkbox"
      orientation="horizontal"
      data-invalid={invalid}
      data-disabled={disabled}
      className={cn('items-start rounded-lg border p-4', className)}
    >
      <Checkbox
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="mt-0.5"
        onBlur={onBlur}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <FieldLabel htmlFor={id} className="min-w-0 wrap-anywhere">
          {children}
        </FieldLabel>
        {details ? (
          <div id={detailsIdOf(id)} className="min-w-0">
            {details}
          </div>
        ) : null}
        {description ? (
          <FieldDescription id={descriptionIdOf(id)}>{description}</FieldDescription>
        ) : null}
        {invalid ? <FieldError id={errorIdOf(id)}>{error}</FieldError> : null}
      </div>
    </Field>
  )
}
