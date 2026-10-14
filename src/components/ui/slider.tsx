// A slider: one value on a scale, chosen by dragging the thumb or with the keys
// Radix gives it (the arrows a step, Page Up and Page Down ten, Home and End the
// ends). It is the Radix slider in the app's look: the quiet `--muted` track, the
// primary fill up to the value, a thumb that wears `focus-ring`, and a control at
// least a tap target tall below `md`, as every control is.
//
// One thumb, controlled. A slider is not named by its label alone: the value it
// reads out is the caller's sentence (`valueText`), because "44" says nothing and
// "4.4, realistic, about 93 reviews" does.
//
// `limit` keeps the scale's end on show while the thumb stops short of it: the
// track runs on to `max` in a quieter stretch that cannot be chosen, and
// the slider says `limit` is its highest value. The Google rating goal draws 5.0
// that way, with its reason beside the slider.
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '#/lib/utils'

/**
 * Names the slider. Required, one way or the other: a bare thumb says nothing.
 * `aria-labelledby` points at a visible label, `aria-label` names it when none is drawn.
 */
type Naming =
  | Readonly<{ 'aria-label': string; 'aria-labelledby'?: undefined }>
  | Readonly<{ 'aria-labelledby': string; 'aria-label'?: undefined }>

export type SliderProps = Naming &
  Readonly<{
    value: number
    onValueChange: (value: number) => void
    min: number
    max: number
    /** The grain of the scale; 1 unless the scale says otherwise. */
    step?: number
    /** The highest value that can be chosen, when it is short of `max`. */
    limit?: number
    /** The value as words, read with it: "4.4, realistic, about 93 reviews". */
    valueText: (value: number) => string
    /** Ids of the text that explains the slider (its live line, its reason). */
    'aria-describedby'?: string
    disabled?: boolean
    className?: string
  }>

/** Where `value` sits on the scale, as a share of it from 0 to 100. */
export function sliderPercent(value: number, min: number, max: number): number {
  if (!(max > min)) return 0
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  limit = max,
  valueText,
  disabled,
  className,
  ...aria
}: SliderProps) {
  const highest = Math.min(limit, max)
  const held = Math.min(Math.max(value, min), highest)
  const beyond = 100 - sliderPercent(highest, min, max)
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={[held]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([next]) => {
        if (next !== undefined) onValueChange(Math.min(next, highest))
      }}
      className={cn(
        'relative flex h-9 w-full touch-none items-center select-none data-[disabled]:opacity-50 max-md:min-h-(--control-touch)',
        className,
      )}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
        {beyond > 0 ? (
          <span
            data-slot="slider-beyond"
            aria-hidden="true"
            className="absolute inset-y-0 right-0 bg-border"
            style={{ width: `${beyond}%` }}
          />
        ) : null}
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        aria-describedby={aria['aria-describedby']}
        aria-valuemax={highest}
        aria-valuetext={valueText(held)}
        className="focus-ring block size-5 rounded-full border-2 border-primary bg-background shadow-sm outline-none disabled:pointer-events-none"
      />
    </SliderPrimitive.Root>
  )
}
