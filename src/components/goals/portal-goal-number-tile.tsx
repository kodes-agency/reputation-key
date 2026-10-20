// The set sheet's number (copy deck S-3, S-11, U-S1): the number as the hero of
// the sheet, in large bold figures between − and + (the shared hero stepper), and
// under it what it counts in its month. The number is a spinbutton the manager
// can also type into: ArrowUp and ArrowDown step along the goal grid, and Enter
// or leaving the box writes the number plainly (what is half-typed stays as
// typed). At an end − or + stays in the tab order (`aria-disabled`), so the focus
// is never lost on a press; while Set is on its way the box is read-only and both
// steps wait the same way, so the number shown is the number sent. The line under
// the number names the box. The one-off sizes (128 px, 88 px on a phone, and the
// smaller figures a narrow phone's room allows) are inline: a utility of its own
// would grow the one stylesheet every page loads first.
import { useId, type KeyboardEvent, type Ref } from 'react'
import { GoalHeroStepper, HERO_STEPPER_GAP, HERO_STEPPER_TOUCH } from './goal-setup-parts'
import type { PortalGoalSheetModel } from './portal-goal-sheet-view'

type Props = Readonly<{
  /** U-S1: "private ratings in November"; names the box. */
  unit: string
  number: PortalGoalSheetModel['number']
  /** A phone: the smaller figures. */
  small: boolean
  /** Set is on its way: the number holds still. */
  pending: boolean
  /** A number with a decimal (the average): the keyboard offers its point. */
  decimal?: boolean
  /** The box itself: a link that goes once it is used moves the focus here first. */
  boxRef?: Ref<HTMLInputElement>
  onType: (text: string) => void
  onCommit: () => void
  onStep: (to: number) => void
  /** Whether the box has the focus: its `aria-valuetext` speaks for it then. */
  onFocusChange: (focused: boolean) => void
}>

/** The figures' full size. */
const FIGURE_SIZE = { large: 128, small: 88 } as const
/**
 * The box is as wide as three figures at full size (and half of one for the
 * caret: the most a goal's average takes is "4.5"); a longer number shrinks to
 * the same width, so it never hides behind the box's edge or pushes − and +
 * apart, down to the nine characters of "1,000,000", the most a goal takes.
 * Past that the box scrolls, as any does.
 */
const FULL_SIZE_FIGURES = 3
const MOST_FIGURES = 9
const CARET_ROOM = 0.5
/**
 * A figure of the display face is about 0.71 em wide, and a phone's row is the
 * box between two steppers and their gaps (both the shared hero stepper's, so the
 * fit follows it). On a phone as narrow as 320 px the full-size box would push −
 * and + off the screen, so the figures take the smaller of their size and what the
 * tile's own width leaves over (its container's, in `cqw`).
 */
const FIGURE_EM = 0.71
const PHONE_STEPPERS = 2 * (HERO_STEPPER_TOUCH + HERO_STEPPER_GAP.phone)

/** The figures' full size here: the size, or on a phone what the room allows of it. */
function fullSize(small: boolean): string {
  if (!small) return `${FIGURE_SIZE.large}px`
  const fits = `(100cqw - ${PHONE_STEPPERS}px) / ${FIGURE_EM * (FULL_SIZE_FIGURES + CARET_ROOM)}`
  return `min(${FIGURE_SIZE.small}px, ${fits})`
}

function figureStyle(text: string, small: boolean) {
  const full = fullSize(small)
  const room =
    Math.min(Math.max(text.length, FULL_SIZE_FIGURES), MOST_FIGURES) + CARET_ROOM
  return {
    fontSize: `calc(${full} * ${(FULL_SIZE_FIGURES + CARET_ROOM) / room})`,
    // The box keeps its height as the figures shrink.
    height: full,
    width: `${room}ch`,
  }
}

export function PortalGoalNumberTile({
  unit,
  number,
  small,
  pending,
  decimal = false,
  boxRef,
  ...props
}: Props) {
  const unitId = useId()
  const stepper = (step: PortalGoalSheetModel['number']['lower']) => ({
    label: step.label,
    inert: pending || step.to === null,
    onPress: () => {
      if (!pending && step.to !== null) props.onStep(step.to)
    },
  })
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
    // The tile is the container the figures' size is measured against.
    <div
      data-slot="portal-goal-number-tile"
      className="flex flex-col items-center text-center"
      style={{ containerType: 'inline-size' }}
    >
      <GoalHeroStepper
        small={small}
        lower={stepper(number.lower)}
        raise={stepper(number.raise)}
      >
        <input
          ref={boxRef}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          role="spinbutton"
          autoComplete="off"
          data-autofocus=""
          aria-labelledby={unitId}
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
          className="display-title focus-ring rounded-xl bg-transparent text-center leading-none font-bold tabular-nums"
          style={figureStyle(number.text, small)}
        />
      </GoalHeroStepper>
      <span
        id={unitId}
        className="text-muted-foreground"
        style={{ fontSize: small ? 16 : 18, marginTop: small ? 2 : 8 }}
      >
        {unit}
      </span>
    </div>
  )
}
