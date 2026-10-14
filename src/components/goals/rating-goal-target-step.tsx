// Step 1, "Pick your goal": what Google shows, the target picked large with its
// label, a slider of tenths from the first stop to 5.0 (shown, never chosen),
// one live line, the warning an out-of-reach stop wears, and the working behind
// it, folded away (ADR 0067, decisions 5 and 10).
import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import type {
  RatingGoalSetupView,
  RatingStopView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { Slider } from '#/components/ui/slider'
import { StatusBadge } from '#/components/ui/status-badge'
import { ratingText, reviewsText, tenthsText } from './rating-goal-view'
import {
  howWeWorkItOut,
  outOfReachWarning,
  PERFECT_STOP_REASON,
  stopAt,
  STOP_LABEL,
  stopValueText,
  targetLine,
} from './rating-goal-wizard-view'

type Props = Readonly<{
  setup: RatingGoalSetupView
  stop: RatingStopView
  onTargetChange: (targetTenths: number) => void
}>

const QUIET = 'text-sm text-muted-foreground'

export function RatingGoalTargetStep({ setup, stop, onTargetChange }: Props) {
  const reasonId = useId()
  const [first] = setup.stops
  const last = setup.stops.at(-1)
  const perfect = setup.perfectStop
  const max = perfect?.targetTenths ?? last?.targetTenths ?? stop.targetTenths
  const warning = outOfReachWarning(stop, setup)
  const google = setup.google
  return (
    <div className="flex flex-col gap-5">
      {google === null || google.shows === null ? null : (
        <p className={QUIET}>
          Google shows {ratingText(google.shows)} from {reviewsText(google.reviewCount)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-baseline gap-2">
          <span className="text-3xl leading-none font-semibold tabular-nums">
            {ratingText(stop.target)}
          </span>
          <span className={QUIET}>goal on Google</span>
        </p>
        <StatusBadge {...STOP_LABEL[stop.label]} />
      </div>
      <div className="flex flex-col gap-1">
        {/* Described by 5.0's reason only: the value text already says what the
            live line below does. */}
        <Slider
          aria-label="Goal on Google"
          aria-describedby={perfect === null ? undefined : reasonId}
          value={stop.targetTenths}
          onValueChange={(tenths) => {
            if (stopAt(setup, tenths) !== null) onTargetChange(tenths)
          }}
          min={first?.targetTenths ?? stop.targetTenths}
          max={max}
          limit={last?.targetTenths}
          valueText={(tenths) => {
            const at = stopAt(setup, tenths)
            return at === null ? tenthsText(tenths) : stopValueText(at, setup.recentMix)
          }}
        />
        <div
          aria-hidden="true"
          className="flex justify-between text-xs text-muted-foreground tabular-nums"
        >
          <span>{tenthsText(first?.targetTenths ?? stop.targetTenths)}</span>
          <span>{tenthsText(max)}</span>
        </div>
        {perfect === null ? null : (
          // Under the 5.0 it explains, at the scale's end.
          <p id={reasonId} className="text-end text-xs text-muted-foreground">
            {tenthsText(perfect.targetTenths)} {PERFECT_STOP_REASON}
          </p>
        )}
      </div>
      <p className="text-base font-medium">{targetLine(stop, setup.recentMix)}</p>
      {warning === null ? null : (
        // Polite: it changes as the thumb moves, and the slider's own value text
        // already says "out of reach"; an alert would cut that off at every step.
        <Alert variant="warning" role="status">
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group -ml-2 w-fit">
            How we work this out
            <ChevronDown
              aria-hidden="true"
              className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-sm text-muted-foreground">
            {howWeWorkItOut(setup, stop).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
