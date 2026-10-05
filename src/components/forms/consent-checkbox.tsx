// The checkbox of a single framed confirmation (UI consistency scan: FORM-11): a
// statement the person agrees to or confirms ("I have read this notice and agree...",
// "I have checked these details", "This property owns this photo..."), or one framed
// yes that stands for a whole list ("Select all current portals", which is a choice and
// not an agreement). One frame, so the same sentence looks the same on the settings
// page, in the setup wizard and in an import: a Field holding the checkbox beside its
// sentence, a line of help under the sentence and the refusal under that. A setting
// that is simply on or off is a `SettingSwitchRow`, and the rows of a list of things to
// choose from keep plain `Checkbox` rows.
import type { ReactNode } from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/components/ui/field'
import { cn } from '#/lib/utils'
import { describedByOf, descriptionIdOf, errorIdOf } from './form-field-frame'

type Props = Readonly<{
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** The sentence the person agrees to or confirms: the checkbox's name. */
  children: ReactNode
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
  description,
  error,
  disabled = false,
  name,
  onBlur,
  className,
}: Props) {
  const invalid = Boolean(error)
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
        aria-describedby={describedByOf(id, description, invalid)}
        className="mt-0.5"
        onBlur={onBlur}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <FieldLabel htmlFor={id} className="min-w-0">
          {children}
        </FieldLabel>
        {description ? (
          <FieldDescription id={descriptionIdOf(id)}>{description}</FieldDescription>
        ) : null}
        {invalid ? <FieldError id={errorIdOf(id)}>{error}</FieldError> : null}
      </div>
    </Field>
  )
}
