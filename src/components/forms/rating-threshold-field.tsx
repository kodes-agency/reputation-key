// "How low a rating" as one field (UI consistency scan: FORM-03): a Select of the
// ratings, each worded "3★ or lower" for the eye and "3 stars or lower" for the ear.
// The Portal editor's private-note threshold (1 to 5), the notification page's per-
// channel threshold (Off, then 1 to 4) and the Organization targets' low-rating
// threshold (1 to 5) are all this field; a field of a different kind is not a rating.
import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { cn } from '#/lib/utils'
import { describedByOf, FormFieldFrame } from './form-field-frame'
import {
  RATING_THRESHOLDS,
  ratingThresholdWords,
  spokenRatingThresholdWords,
} from './rating-threshold'

const OFF = 'off'

/**
 * What the field chooses. Without `offLabel` it is always a rating; with it the field
 * also offers a first choice that means "no threshold" (the word it gives: "Off"),
 * which reads and reports `null`.
 */
type Choice =
  | Readonly<{
      offLabel?: undefined
      value: number
      onValueChange: (value: number) => void
    }>
  | Readonly<{
      offLabel: string
      value: number | null
      onValueChange: (value: number | null) => void
    }>

type Props = Choice &
  Readonly<{
    id: string
    label: string
    /** The ratings on offer, lowest first: all five unless the caller's rule stops short. */
    thresholds?: readonly number[]
    /** A line under the field on what it is for; the select names it as its description. */
    description?: ReactNode
    invalid?: boolean
    errors?: Array<{ message?: string } | undefined>
    disabled?: boolean
    /** The select's name when it must say more than the label (the category it belongs to). */
    accessibleName?: string
    /** Merged onto the Field: a width a row gives it (`w-auto`). */
    className?: string
    /** Merged onto the select itself (`w-40`); it fills the field unless told otherwise. */
    triggerClassName?: string
    onBlur?: () => void
  }>

/** "3★ or lower" on screen and "3 stars or lower" read aloud, in the list and once chosen. */
function ThresholdWords({ threshold }: Readonly<{ threshold: number }>) {
  return (
    <>
      <span aria-hidden="true">{ratingThresholdWords(threshold)}</span>
      <span className="sr-only">{spokenRatingThresholdWords(threshold)}</span>
    </>
  )
}

export function RatingThresholdField(props: Props) {
  const {
    id,
    label,
    thresholds = RATING_THRESHOLDS,
    description,
    invalid = false,
    errors,
    disabled = false,
    accessibleName,
    className,
    triggerClassName,
    onBlur,
  } = props
  const choose = (next: string) => {
    if (next !== OFF) props.onValueChange(Number(next))
    else if (props.offLabel !== undefined) props.onValueChange(null)
  }
  return (
    <FormFieldFrame
      id={id}
      label={label}
      description={description}
      invalid={invalid}
      errors={invalid ? errors : undefined}
      className={className}
    >
      <Select
        value={props.value === null ? OFF : String(props.value)}
        disabled={disabled}
        onValueChange={choose}
      >
        <SelectTrigger
          id={id}
          aria-label={accessibleName}
          aria-invalid={invalid || undefined}
          aria-describedby={describedByOf(id, description, invalid)}
          className={cn('w-full min-w-0', triggerClassName)}
          onBlur={onBlur}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.offLabel === undefined ? null : (
              <SelectItem value={OFF}>{props.offLabel}</SelectItem>
            )}
            {thresholds.map((threshold) => (
              <SelectItem
                key={threshold}
                value={String(threshold)}
                textValue={spokenRatingThresholdWords(threshold)}
              >
                <ThresholdWords threshold={threshold} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </FormFieldFrame>
  )
}
