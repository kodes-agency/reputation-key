// The one control for "which window am I looking at": a time range, drawn as a
// segmented control (a short, always-answered choice, see `segmented-control`)
// where a row of segments fits and as a Select below `sm`, where five segments
// would wrap on a phone. Both render the same options under the same name, and
// the page shows one at a time with CSS alone, so there is no layout flash and no
// width to measure. The segments are a tap target below `md`.
//
// The control is controlled and remembers nothing: a range is the state of the
// page it filters, and the page keeps it where it keeps its other state. A
// dashboard topic page keeps it in the URL (`?range=`), so a link or a reload
// reads the same window. The Portal Results window is a viewing preference that
// follows a reader from portal to portal, so it is remembered per reader
// (`portal-results-window.ts`). Each page brings its own preset list; the
// control is the shell, not the vocabulary.
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
}>

export const RANGE_CONTROL_LABEL = 'Time range'

export function RangeControl<T extends string>({
  value,
  onValueChange,
  options,
  label = RANGE_CONTROL_LABEL,
}: Props<T>) {
  // The options are the only source of a value, so a value that is not one of
  // them (a stale event) is dropped here rather than cast to T.
  const choose = (next: string) => {
    const option = options.find((candidate) => candidate.value === next)
    if (option) onValueChange(option.value)
  }
  return (
    <>
      <div className="sm:hidden">
        <Select value={value} onValueChange={choose}>
          <SelectTrigger aria-label={label} className="min-w-32">
            <SelectValue />
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
      </div>
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
