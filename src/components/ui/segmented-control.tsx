// A segmented control: a short, always-answered choice drawn as one pill of
// buttons (preview language, preview version, print side, range). It is a radio
// group — exactly one option is chosen at any time, the four arrow keys move
// the choice and focus together (no `orientation`: Radix's radio default keeps
// Up and Down working for screen-reader users), and Tab enters and leaves the group once — so it
// wears `role="radiogroup"` with a `role="radio"` per segment, as the round-4
// boards draw it. Not `Tabs`: nothing here swaps a panel.
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { cn } from '#/lib/utils'

export type SegmentedControlOption = Readonly<{
  value: string
  /** What the segment prints: a code or a short word (`EN`, `30 days`). */
  label: string
  /**
   * The full name for a label that is an abbreviation (`English` for `EN`). The
   * segment's accessible name becomes `EN English`: the visible label stays in
   * the name (WCAG 2.5.3) and the full word follows it. An `sr-only` span is
   * not used because it is absolutely positioned, so its leading space is
   * dropped and the name reads `ENEnglish`. Leave it out when the label already
   * says everything.
   */
  accessibleLabel?: string
  disabled?: boolean
}>

/**
 * Names the group. Required, one way or the other: a bare row of `EN BG ES`
 * says nothing on its own. `aria-labelledby` points at a visible label beside
 * the control (the boards' "Print side"), `aria-label` names it when none is drawn.
 */
type Naming =
  | Readonly<{ 'aria-label': string; 'aria-labelledby'?: undefined }>
  | Readonly<{ 'aria-labelledby': string; 'aria-label'?: undefined }>

type Props = Naming &
  Readonly<{
    value: string
    onValueChange: (value: string) => void
    options: ReadonlyArray<SegmentedControlOption>
    disabled?: boolean
    className?: string
  }>

/**
 * A 26 px segment inside a 2 px inset in a muted pill. The chosen segment is
 * the boards' white chip: `bg-card` with a 1 px `--border-control` ring (3:1 on
 * the pill, WCAG 1.4.11) and a soft drop, so it reads as chosen without leaning
 * on text weight or hue. In the dark theme the fill follows `tabs.tsx`
 * (`bg-input/30`) and the ring carries the shape.
 */
const CHOSEN_EDGE =
  'data-[state=checked]:shadow-[0_0_0_1px_var(--border-control),0_1px_2px_rgb(0_0_0/0.1)]'
const SEGMENT_CLASS =
  'inline-flex h-[26px] items-center justify-center rounded-sm px-2.5 text-[13px] leading-5 whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-card data-[state=checked]:font-medium data-[state=checked]:text-foreground dark:data-[state=checked]:bg-input/30 ' +
  CHOSEN_EDGE

export function SegmentedControl({
  value,
  onValueChange,
  options,
  disabled,
  className,
  ...props
}: Props) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented-control"
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          data-slot="segmented-control-item"
          value={option.value}
          disabled={option.disabled}
          aria-label={
            option.accessibleLabel === undefined
              ? undefined
              : `${option.label} ${option.accessibleLabel}`
          }
          className={SEGMENT_CLASS}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}
