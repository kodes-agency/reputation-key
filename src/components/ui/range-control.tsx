// The one control for "which window am I looking at": a time range, drawn as a
// segmented control where a row of segments fits and as a Select below `sm`, where
// five segments would wrap on a phone. Both render the same options under the same
// name and the page shows one at a time with CSS alone, so there is no layout flash
// and no width to measure. The segments are a tap target below `md`.
//
// The control is controlled and remembers nothing: a range is the state of the page
// it filters. Each page brings its own preset list; the control is the shell, not
// the vocabulary.
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SegmentedControl } from './segmented-control'

export type RangeOption<T extends string> = Readonly<{ value: T; label: string }>

type Props<T extends string> = Readonly<{
  value: T
  onValueChange: (value: T) => void
  options: ReadonlyArray<RangeOption<T>>
  /** The control's name, at any width. */
  label?: string
  variant?: 'responsive' | 'select'
}>

export const RANGE_CONTROL_LABEL = 'Time range'

export function RangeControl<T extends string>({
  value,
  onValueChange,
  options,
  label = RANGE_CONTROL_LABEL,
  variant = 'responsive',
}: Props<T>) {
  // The options are the only source of a value, so a value that is not one of
  // them (a stale event) is dropped here rather than cast to T.
  const choose = (next: string) => {
    const option = options.find((candidate) => candidate.value === next)
    if (option) onValueChange(option.value)
  }
  const select = (
    <Select value={value} onValueChange={choose}>
      <SelectTrigger
        aria-label={label}
        className={variant === 'responsive' ? 'min-w-32' : undefined}
      >
        <SelectValue>
          {options.find((option) => option.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
  if (variant === 'select') return select
  return (
    <>
      <div className="sm:hidden">{select}</div>
      <SegmentedControl
        aria-label={label}
        value={value}
        onValueChange={choose}
        options={options}
        touch
        className="hidden sm:inline-flex"
      />
    </>
  )
}
