// "Build your own" (round 2, R2-6): three rows, Goal on Google, New reviews will
// average and New reviews a week, each with its options and "Own", then the live
// total from the engine's own preview. "Own" is the slider of tenths for the
// goal (5.0 shown and never chosen), a number in 0.1★ steps for the average
// (held to the target's floor with a clear message) and a whole number a week
// (1 to 200, with a caution above twice the pace now: Google flags surges).
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
import {
  ownTotal,
  paceOptions,
  qualityFloorStars,
  qualityHint,
  qualityOptions,
  rowProblems,
  targetOptions,
} from './rating-goal-build-own-view'
import { RatingGoalPlanRow } from './rating-goal-plan-row'
import type { OwnPlan, RowPick } from './rating-goal-plan-view'
import { tenthsText } from './rating-goal-view'
import { PERFECT_STOP_REASON, STOP_LABEL } from './rating-goal-wizard-view'

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
  const labelOf = (tenths: number) => {
    const stop = setup.stops.find((each) => each.targetTenths === tenths)
    return stop === undefined
      ? tenthsText(tenths)
      : `${tenthsText(tenths)}, ${STOP_LABEL[stop.label].label.toLowerCase()}`
  }
  return (
    <div className="flex flex-col gap-1">
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
  return (
    <div className="flex flex-col gap-5">
      <RatingGoalPlanRow
        label="Goal on Google"
        options={targetOptions(planning)}
        pick={own.target}
        onPick={(pick) => onOwn({ ...own, target: pick })}
        own={
          <OwnTarget
            setup={setup}
            pick={own.target}
            onPick={(pick) => onOwn({ ...own, target: pick })}
          />
        }
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
      <p aria-live="polite" className="text-base font-medium tabular-nums">
        {ownTotal(preview, own)}
      </p>
    </div>
  )
}
