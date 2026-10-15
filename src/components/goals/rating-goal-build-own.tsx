// "Build your own" (round 2, R2-6): three rows, Goal on Google, New reviews will
// average and New reviews a week, each with its options and "Own", then the live
// total from the engine's own preview, with "More than a year" beside it when the
// plan is out of reach at its pace. "Own" is the slider of tenths for the goal
// (the goal picked large with its label above it, 5.0 shown and never chosen), a
// number in 0.1★ steps for the average (held to the target's floor with a clear
// message) and a whole number a week (1 to 200, with a caution above twice the
// pace now: Google flags surges). A new goal keeps a picked average it also
// offers and moves one it does not to its recommendation (`ownWithTarget`).
import type { Ref } from 'react'
import type {
  RatingGoalForecastInputs,
  RatingGoalPlanningView,
  RatingGoalPlanPreview,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { FormNumberField } from '#/components/forms/form-number-field'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Slider } from '#/components/ui/slider'
import { StatusBadge } from '#/components/ui/status-badge'
import {
  ownCaution,
  ownTotal,
  ownWithTarget,
  paceOptions,
  qualityFloorStars,
  qualityHint,
  qualityOptions,
  rowProblems,
  targetOptions,
} from './rating-goal-build-own-view'
import { QUIET } from './rating-goal-option'
import { RatingGoalPlanRow } from './rating-goal-plan-row'
import type { OwnPlan, RowPick } from './rating-goal-plan-view'
import { tenthsText } from './rating-goal-view'
import { PERFECT_STOP_REASON, STOP_LABEL } from './rating-goal-wizard-view'
import { RatingGoalWholeDates } from './rating-goal-whole-dates'

type Props = Readonly<{
  setup: RatingGoalSetupView
  planning: RatingGoalPlanningView
  inputs: RatingGoalForecastInputs
  own: OwnPlan
  onOwn: (own: OwnPlan) => void
  preview: RatingGoalPlanPreview
  /** The average's row, which "Change" on the plans' quality moves the focus to. */
  qualityRef: Ref<HTMLDivElement>
  idBase: string
}>

/** An "Own" number as the form field reads it, with the row's problem as its error. */
const numberField = (
  value: number,
  problem: string | null,
  onChange: (value: number) => void,
) => ({
  state: {
    value,
    meta: { errors: problem === null ? [] : [{ message: problem }] },
  },
  handleBlur: () => undefined,
  handleChange: onChange,
})

function OwnTarget({
  setup,
  pick,
  onPick,
}: Readonly<{
  setup: RatingGoalSetupView
  pick: RowPick
  onPick: (pick: RowPick) => void
}>) {
  const [first] = setup.stops
  const last = setup.stops.at(-1)
  if (first === undefined || last === undefined) return null
  const perfect = setup.perfectStop
  const stopAt = (tenths: number) =>
    setup.stops.find((each) => each.targetTenths === tenths)
  const labelOf = (tenths: number) => {
    const stop = stopAt(tenths)
    return stop === undefined
      ? tenthsText(tenths)
      : `${tenthsText(tenths)}, ${STOP_LABEL[stop.label].label.toLowerCase()}`
  }
  const picked = stopAt(pick.value)
  return (
    <div className="flex flex-col gap-1">
      {/* The goal picked, large, with the label the target row's options wear. */}
      <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {tenthsText(pick.value)}
          </span>{' '}
          <span className={QUIET}>on Google</span>
        </span>{' '}
        {picked === undefined ? null : <StatusBadge {...STOP_LABEL[picked.label]} />}
      </p>
      <Slider
        aria-label="Your own goal on Google"
        value={pick.value}
        onValueChange={(tenths) => onPick({ own: true, value: tenths })}
        min={first.targetTenths}
        max={perfect?.targetTenths ?? last.targetTenths}
        limit={last.targetTenths}
        valueText={labelOf}
      />
      <div
        aria-hidden="true"
        className="flex justify-between text-xs text-muted-foreground tabular-nums"
      >
        <span>{tenthsText(first.targetTenths)}</span>
        <span>{tenthsText(perfect?.targetTenths ?? last.targetTenths)}</span>
      </div>
      {perfect === null ? null : (
        <p className="text-end text-xs text-muted-foreground">
          {tenthsText(perfect.targetTenths)} {PERFECT_STOP_REASON}
        </p>
      )}
    </div>
  )
}

export function RatingGoalBuildOwn({
  setup,
  planning,
  inputs,
  own,
  onOwn,
  preview,
  qualityRef,
  idBase,
}: Props) {
  const problems = rowProblems(preview, own)
  const target = own.target.value
  const caution = ownCaution(preview)
  const pickTarget = (pick: RowPick) => onOwn(ownWithTarget(inputs, own, pick))
  return (
    <div className="flex flex-col gap-5">
      <RatingGoalPlanRow
        label="Goal on Google"
        options={targetOptions(planning)}
        pick={own.target}
        onPick={pickTarget}
        own={<OwnTarget setup={setup} pick={own.target} onPick={pickTarget} />}
      />
      <RatingGoalPlanRow
        label="New reviews will average"
        hint={qualityHint(setup, target)}
        options={qualityOptions(inputs, target)}
        pick={own.quality}
        onPick={(pick) => onOwn({ ...own, quality: pick })}
        groupRef={qualityRef}
        own={
          <FormNumberField
            id={`${idBase}-own-quality`}
            label="Your own average (stars)"
            min={qualityFloorStars(inputs, target)}
            max={5}
            step={0.1}
            className="max-w-48"
            field={numberField(own.quality.value, problems.quality, (value) =>
              onOwn({ ...own, quality: { own: true, value } }),
            )}
          />
        }
      />
      <RatingGoalPlanRow
        label="New reviews a week"
        options={paceOptions(setup, planning)}
        pick={own.pace}
        onPick={(pick) => onOwn({ ...own, pace: pick })}
        own={
          <FormNumberField
            id={`${idBase}-own-pace`}
            label="Your own number a week"
            min={1}
            max={200}
            className="max-w-48"
            field={numberField(own.pace.value, problems.pace, (value) =>
              onOwn({ ...own, pace: { own: true, value } }),
            )}
          />
        }
      />
      {preview.valid && preview.surgeCaution ? (
        <Alert variant="warning">
          <AlertDescription>
            That is more than twice the pace you get now. Google may flag a sudden jump in
            new reviews, so a steadier pace is safer.
          </AlertDescription>
        </Alert>
      ) : null}
      <p
        aria-live="polite"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-medium tabular-nums"
      >
        <span>
          <RatingGoalWholeDates text={ownTotal(preview, own)} />
        </span>{' '}
        {caution === null ? null : <StatusBadge tone="warn" label={caution} />}
      </p>
    </div>
  )
}
