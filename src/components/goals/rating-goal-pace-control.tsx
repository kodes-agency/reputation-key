// "New reviews": the one lever a manager is asked to pull (rounds 3 and 4,
// R3-1/R3-3, R4-3). A day or a month, the recommended stops on the app's
// Slider (its touch height built in), the stops' labels with "Recommended"
// under the one it is, the note against today's pace, "Your own" in either
// unit, and how to ask (R3-12). An own pace shows in the value and the note;
// the thumb sits on the nearest stop, and moving it goes back to the stops. A
// typed pace is applied on Enter or when the field is left, clamped with its
// reason.
import { useState, type KeyboardEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { Slider } from '#/components/ui/slider'
import { TONE_INK } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import { HOW_TO_ASK_LINE } from './rating-goal-copy'
import { paceText } from './rating-goal-pace-words'
import { paceNote } from './rating-goal-setup-copy'
import type { PaceUnit, SetupPlan } from './rating-goal-setup-draft'
import {
  dayTenthsOf,
  perMonthOf,
} from '#/contexts/reporting/application/rating-goal-setup-plan'

type Props = Readonly<{
  plan: SetupPlan
  unit: PaceUnit
  ownOn: boolean
  message: string | undefined
  idBase: string
  small: boolean
  onUnit: (unit: PaceUnit) => void
  onChip: (index: number) => void
  onToggleOwn: () => void
  onTypeOwn: (raw: string) => void
}>

const UNITS = [
  { value: 'day', label: 'a day' },
  { value: 'month', label: 'a month' },
] as const

/** The stop an own pace sits nearest to. */
function nearestChip(plan: SetupPlan): number {
  const { chips, tenthsPerWeek } = plan.pace
  let best = 0
  chips.forEach((chip, index) => {
    const off = Math.abs(chip.tenthsPerWeek - tenthsPerWeek)
    if (off < Math.abs((chips[best]?.tenthsPerWeek ?? 0) - tenthsPerWeek)) best = index
  })
  return best
}

/** The own pace as the field shows it: one decimal a day, a whole number a month. */
const ownValue = (tenths: number, unit: PaceUnit): string =>
  unit === 'day' ? String(dayTenthsOf(tenths) / 10) : String(perMonthOf(tenths))

/** A stop's words under the track: "1.5" a day, "3 a week" under one, "45" a month. */
const stopLabel = (tenths: number, unit: PaceUnit): string =>
  unit === 'month' ? String(perMonthOf(tenths)) : paceText(tenths).replace(/ a day$/u, '')

/** A stop's label, flush with the track's ends. */
function stopStyle(index: number, last: number) {
  const fraction = last === 0 ? 0 : index / last
  const shift = index === 0 ? '-10px' : index === last ? 'calc(-100% + 10px)' : '-50%'
  return {
    left: `calc(10px + ${fraction} * (100% - 20px))`,
    transform: `translateX(${shift})`,
    alignItems: index === 0 ? 'flex-start' : index === last ? 'flex-end' : 'center',
  } as const
}

function OwnField({ plan, unit, idBase, onTypeOwn }: Props) {
  const [typed, setTyped] = useState<string | null>(null)
  const commit = () => {
    if (typed === null) return
    onTypeOwn(typed)
    setTyped(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commit()
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Input
        inputMode={unit === 'day' ? 'decimal' : 'numeric'}
        value={typed ?? ownValue(plan.pace.tenthsPerWeek, unit)}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-labelledby={`${idBase}-pace`}
        aria-describedby={`${idBase}-pace-note`}
        className="text-right font-semibold"
        style={{ width: 76 }}
      />
      {unit === 'day' ? 'a day' : 'a month'}
    </span>
  )
}

function Stops({ plan, unit, ownOn, onChip }: Props) {
  const { chips, recommendedIndex, chosenIndex } = plan.pace
  const last = chips.length - 1
  return (
    <div aria-hidden="true" className="relative" style={{ height: 34 }}>
      {chips.map((chip, index) => (
        <Button
          key={chip.tenthsPerWeek}
          type="button"
          variant="ghost"
          size="inline"
          tabIndex={-1}
          onClick={() => onChip(index)}
          className={cn(
            'absolute top-0 flex-col gap-0 text-sm hover:bg-transparent',
            !ownOn && index === chosenIndex
              ? 'font-semibold text-foreground'
              : 'font-normal text-muted-foreground',
          )}
          style={stopStyle(index, last)}
        >
          <span>{stopLabel(chip.tenthsPerWeek, unit)}</span>
          {index === recommendedIndex ? (
            <span className="text-xs font-semibold text-link">Recommended</span>
          ) : null}
        </Button>
      ))}
    </div>
  )
}

export function RatingGoalPaceControl(props: Props) {
  const { plan, unit, ownOn, idBase, small } = props
  const { chips, recommendedIndex } = plan.pace
  const index = ownOn ? nearestChip(plan) : (plan.pace.chosenIndex ?? recommendedIndex)
  const valueText = (at: number) => {
    const chip = chips[at]
    const words = chip === undefined ? '' : paceText(chip.tenthsPerWeek, unit)
    return at === recommendedIndex ? `${words}, recommended` : words
  }
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3" style={{ minHeight: 36 }}>
        <span
          id={`${idBase}-pace`}
          className="text-sm whitespace-nowrap text-muted-foreground"
        >
          New reviews
        </span>
        <SegmentedControl
          aria-label="Count new reviews"
          value={unit}
          onValueChange={(value) => props.onUnit(value === 'month' ? 'month' : 'day')}
          options={UNITS}
          touch
        />
        <span className="flex-1" />
        {ownOn ? (
          <OwnField key={unit} {...props} />
        ) : (
          <span
            className="font-semibold whitespace-nowrap"
            style={{ fontSize: small ? 17 : 20 }}
          >
            {paceText(plan.pace.tenthsPerWeek, unit)}
          </span>
        )}
      </div>
      {chips.length > 1 ? (
        <Slider
          aria-labelledby={`${idBase}-pace`}
          aria-describedby={`${idBase}-pace-note`}
          value={index}
          min={0}
          max={chips.length - 1}
          valueText={valueText}
          onValueChange={props.onChip}
        />
      ) : null}
      <Stops {...props} />
      <div className="flex items-baseline gap-4 text-sm text-muted-foreground">
        <span id={`${idBase}-pace-note`} className="flex-1">
          {props.message === undefined ? null : (
            <span className={TONE_INK.warn}>{props.message} </span>
          )}
          {paceNote(plan, unit)}
        </span>
        <Button type="button" variant="link" size="inline" onClick={props.onToggleOwn}>
          {ownOn ? 'Back to options' : 'Your own'}
        </Button>
      </div>
      <p
        className="mt-2 pl-3 text-xs text-muted-foreground"
        style={{ borderInlineStart: '2px solid var(--border)' }}
      >
        <b className="font-semibold text-foreground">{HOW_TO_ASK_LINE.lead}</b>{' '}
        {HOW_TO_ASK_LINE.text}
      </p>
    </div>
  )
}
