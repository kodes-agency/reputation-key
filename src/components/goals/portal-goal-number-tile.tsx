// The set sheet's number (copy deck S-3, S-11): a calendar leaf with the month
// on its band, the number in large foreground figures, and its unit, between −
// and +. The number is a spinbutton the manager can also type into: ArrowUp and
// ArrowDown step along the goal grid, and Enter or leaving the box writes the
// number plainly (what is half-typed stays as typed). At an end − or + stays
// in the tab order (`aria-disabled`), so the focus is never lost on a press.
// The one-off sizes (56 px, 48 px on a phone) are inline: a utility of its own
// would grow the one stylesheet every page loads first.
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
  onType: (text: string) => void
  onCommit: () => void
  onStep: (to: number) => void
  /** Whether the box has the focus: its `aria-valuetext` speaks for it then. */
  onFocusChange: (focused: boolean) => void
}>

/** The figures' size, and the room the box keeps for six of them. */
const FIGURE_SIZE = { large: 56, small: 48 } as const
const FIGURE_WIDTH = '4.5ch'

function Stepper({
  step,
  icon: Icon,
  onStep,
}: Readonly<{
  step: PortalGoalSheetModel['number']['lower']
  icon: LucideIcon
  onStep: (to: number) => void
}>) {
  const { to } = step
  return (
    <IconButton
      label={step.label}
      variant="outline"
      size="icon-lg"
      aria-disabled={to === null}
      onClick={() => {
        if (to !== null) onStep(to)
      }}
    >
      <Icon aria-hidden="true" />
    </IconButton>
  )
}

export function PortalGoalNumberTile({ band, unit, number, small, ...props }: Props) {
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
      if (to !== null) props.onStep(to)
      return
    }
    if (event.key !== 'Enter') return
    // Enter writes the number; Set is the footer's to press.
    event.preventDefault()
    props.onCommit()
  }
  return (
    <div className="flex items-center justify-center gap-4">
      <Stepper step={number.lower} icon={Minus} onStep={props.onStep} />
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
          inputMode="numeric"
          role="spinbutton"
          autoComplete="off"
          data-autofocus=""
          aria-labelledby={`${bandId} ${unitId}`}
          aria-valuenow={number.value ?? undefined}
          aria-valuemin={1}
          aria-valuetext={number.valueText ?? undefined}
          aria-invalid={number.invalid || undefined}
          value={number.text}
          onChange={(event) => props.onType(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => props.onFocusChange(true)}
          onBlur={() => {
            props.onFocusChange(false)
            props.onCommit()
          }}
          className="display-title focus-ring mx-2 mt-1 rounded-md bg-transparent text-center leading-none font-semibold tabular-nums"
          style={{
            fontSize: small ? FIGURE_SIZE.small : FIGURE_SIZE.large,
            width: FIGURE_WIDTH,
          }}
        />
        <span id={unitId} className="px-3 pb-2 text-sm text-muted-foreground">
          {unit}
        </span>
      </div>
      <Stepper step={number.raise} icon={Plus} onStep={props.onStep} />
    </div>
  )
}
