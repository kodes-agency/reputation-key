// Step 2, "Pick your pace": the target the pace is for, the pace there is now,
// three cards (Steady, Faster preselected, Push) each with its weekly number and
// forecast, the month and day figures on the chosen one only, and a number of
// one's own, 1 to 200 a week, with a caution above twice the pace there is now
// (Google flags surges). Each card is pressed anywhere on it, not only on its
// radio: the label is stretched over the whole card.
import { useId } from 'react'
import type {
  RatingGoalSetupView,
  RatingStopView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { previewRatingGoalPace } from '#/contexts/reporting/application/rating-goal-preview'
import { FormNumberField } from '#/components/forms/form-number-field'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { forecastSentence, perMonthAndDay, ratingText } from './rating-goal-view'
import {
  currentPaceLine,
  customPaceProblem,
  paceCards,
  type PaceChoice,
} from './rating-goal-wizard-view'

const CUSTOM = 'custom'

/** A radio card: the chosen one wears the primary edge and tint. */
const OPTION =
  'relative flex min-h-(--control-touch) items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'
/** The card's label, stretched over the whole card so any of it picks the pace. */
const OPTION_LABEL =
  'cursor-pointer font-normal after:absolute after:inset-0 after:rounded-lg'
const QUIET = 'text-sm text-muted-foreground'

type Props = Readonly<{
  setup: RatingGoalSetupView
  stop: RatingStopView
  choice: PaceChoice
  onChoiceChange: (choice: PaceChoice) => void
  /** The number in the field, which may not be a valid pace yet. */
  customPace: number
  onCustomPaceChange: (perWeek: number) => void
}>

/** What a pace typed in comes to: its forecast and, above twice the pace now, a caution. */
function CustomOutcome({
  setup,
  stop,
  perWeek,
}: Readonly<{
  setup: RatingGoalSetupView
  stop: RatingStopView
  perWeek: number
}>) {
  if (setup.forecastInputs === null || customPaceProblem(perWeek) !== null) return null
  const preview = previewRatingGoalPace(setup.forecastInputs, stop.targetTenths, perWeek)
  return (
    <>
      <p className={QUIET}>
        {forecastSentence(preview.forecast, stop.target, 'Around')} ·{' '}
        {perMonthAndDay(preview.pace)}
      </p>
      {preview.surgeCaution ? (
        <Alert variant="warning">
          <AlertDescription>
            That is more than twice the pace you get now. Google may flag a sudden jump in
            new reviews, so a steadier pace is safer.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

export function RatingGoalPaceStep({
  setup,
  stop,
  choice,
  onChoiceChange,
  customPace,
  onCustomPaceChange,
}: Props) {
  const groupLabel = useId()
  const selected = choice.kind === 'preset' ? choice.key : CUSTOM
  const problem = customPaceProblem(customPace)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">For {ratingText(stop.target)} on Google</p>
        <p id={groupLabel} className={QUIET}>
          {currentPaceLine(setup.currentPacePerWeek)}
        </p>
      </div>
      <RadioGroup
        aria-label="New Google reviews a week"
        aria-describedby={groupLabel}
        value={selected}
        onValueChange={(value) => {
          const preset = paceCards(setup, stop).find((card) => card.key === value)
          onChoiceChange(
            preset === undefined
              ? { kind: 'custom', perWeek: customPace }
              : { kind: 'preset', key: preset.key },
          )
        }}
        className="sm:grid-cols-3"
      >
        {paceCards(setup, stop).map((card) => {
          const id = `${groupLabel}-${card.key}`
          return (
            <div key={card.key} className={OPTION}>
              <RadioGroupItem value={card.key} id={id} className="mt-0.5" />
              <Label
                htmlFor={id}
                className={`${OPTION_LABEL} flex-col items-start gap-1`}
              >
                <span className="text-sm font-medium">{card.name}</span>
                <span className="text-lg font-semibold tabular-nums">{card.perWeek}</span>
                <span className={QUIET}>{card.forecast}</span>
                {selected === card.key ? (
                  <span className={QUIET}>{card.perMonthAndDay}</span>
                ) : null}
              </Label>
            </div>
          )
        })}
        <div className={`${OPTION} sm:col-span-3`}>
          <RadioGroupItem value={CUSTOM} id={`${groupLabel}-custom`} className="mt-0.5" />
          <Label htmlFor={`${groupLabel}-custom`} className={OPTION_LABEL}>
            Or type your own number
          </Label>
        </div>
      </RadioGroup>
      {choice.kind === 'custom' ? (
        <div className="flex flex-col gap-2">
          <FormNumberField
            id={`${groupLabel}-custom-pace`}
            label="New reviews a week"
            min={1}
            max={200}
            className="max-w-40"
            field={{
              state: {
                value: customPace,
                meta: { errors: problem === null ? [] : [{ message: problem }] },
              },
              handleBlur: () => undefined,
              handleChange: (value) => {
                onCustomPaceChange(value)
                onChoiceChange({ kind: 'custom', perWeek: value })
              },
            }}
          />
          <CustomOutcome setup={setup} stop={stop} perWeek={customPace} />
        </div>
      ) : null}
    </div>
  )
}
