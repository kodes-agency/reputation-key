// The set sheet's number (copy deck S-3, S-11): a calendar leaf with the month
// on its band, the number in large foreground figures, and its unit, between −
// and +. The number is a spinbutton the manager can also type into: ArrowUp and
// ArrowDown step along the goal grid, and Enter or leaving the box writes the
// number plainly (what is half-typed stays as typed). At an end − or + stays
// in the tab order (`aria-disabled`), so the focus is never lost on a press;
// while Set is on its way the box is read-only and both steps wait the same
// way, so the number shown is the number sent. The one-off sizes (56 px, 48 px
// on a phone) are inline: a utility of its own would grow the one stylesheet
// every page loads first.
import { useId, type KeyboardEvent } from 'react'
import { Minus, Plus, type LucideIcon } from 'lucide-react'
import { IconButton } from '#/components/ui/icon-button'
import type { PortalGoalSheetModel } from './portal-goal-sheet-view'

type Props = Readonly<{
  band: string
  unit: string
  number: PortalGoalSheetModel['number']
  /** A phone: the smaller figures. */
  small: boolean
  /** Set is on its way: the number holds still. */
  pending: boolean
  /** A number with a decimal (the average): the keyboard offers its point. */
  decimal?: boolean
  onType: (text: string) => void
  onCommit: () => void
  onStep: (to: number) => void
  /** Whether the box has the focus: its `aria-valuetext` speaks for it then. */
  onFocusChange: (focused: boolean) => void
}>

/** The figures' full size. */
const FIGURE_SIZE = { large: 56, small: 48 } as const
/**
 * The box is as wide as four figures at full size (and half of one for the
 * caret); a longer number shrinks to the same width, so it never hides behind
 * the box's edge or pushes − and + apart, down to the nine characters of
 * "1,000,000", the most a goal takes. Past that the box scrolls, as any does.
 */
const FULL_SIZE_FIGURES = 4
const MOST_FIGURES = 9
const CARET_ROOM = 0.5

function figureStyle(text: string, small: boolean) {
  const full = small ? FIGURE_SIZE.small : FIGURE_SIZE.large
  const room =
    Math.min(Math.max(text.length, FULL_SIZE_FIGURES), MOST_FIGURES) + CARET_ROOM
  return {
    fontSize: (full * (FULL_SIZE_FIGURES + CARET_ROOM)) / room,
    // The box keeps its height as the figures shrink.
    height: full,
    width: `${room}ch`,
  }
}

function Stepper({
  step,
  icon: Icon,
  waits,
  onStep,
}: Readonly<{
  step: PortalGoalSheetModel['number']['lower']
  icon: LucideIcon
  /** Set is on its way. */
  waits: boolean
  onStep: (to: number) => void
}>) {
  const { to } = step
  return (
    <IconButton
      label={step.label}
      variant="outline"
      size="icon-lg"
      aria-disabled={waits || to === null}
      onClick={() => {
        if (!waits && to !== null) onStep(to)
      }}
    >
      <Icon aria-hidden="true" />
    </IconButton>
  )
}

export function PortalGoalNumberTile({
  band,
  unit,
  number,
  small,
  pending,
  decimal = false,
  ...props
}: Props) {
  const id = useId()
  const bandId = `${id}-band`
  const unitId = `${id}-unit`
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const to =
      event.key === 'ArrowUp'
        ? number.raise.to
        : event.key === 'ArrowDown'
          ? number.lower.to
          : undefined
    if (to !== undefined) {
      event.preventDefault()
      if (!pending && to !== null) props.onStep(to)
      return
    }
    if (event.key !== 'Enter') return
    // Enter writes the number; Set is the footer's to press.
    event.preventDefault()
    props.onCommit()
  }
  return (
    <div className="flex items-center justify-center gap-4">
      <Stepper step={number.lower} icon={Minus} waits={pending} onStep={props.onStep} />
      <div
        data-slot="portal-goal-number-tile"
        className="flex flex-col items-center overflow-hidden rounded-md border"
      >
        <span
          id={bandId}
          className="w-full bg-muted px-3 text-center text-[10px] tracking-wide text-muted-foreground uppercase"
        >
          {band}
        </span>
        <input
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          role="spinbutton"
          autoComplete="off"
          data-autofocus=""
          aria-labelledby={`${bandId} ${unitId}`}
          aria-valuenow={number.value ?? undefined}
          aria-valuemin={1}
          aria-valuetext={number.valueText ?? undefined}
          aria-invalid={number.invalid || undefined}
          readOnly={pending}
          value={number.text}
          onChange={(event) => props.onType(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => props.onFocusChange(true)}
          onBlur={() => {
            props.onFocusChange(false)
            props.onCommit()
          }}
          className="display-title focus-ring mx-2 mt-1 rounded-md bg-transparent text-center leading-none font-semibold tabular-nums"
          style={figureStyle(number.text, small)}
        />
        <span id={unitId} className="px-3 pb-2 text-sm text-muted-foreground">
          {unit}
        </span>
      </div>
      <Stepper step={number.raise} icon={Plus} waits={pending} onStep={props.onStep} />
    </div>
  )
}
