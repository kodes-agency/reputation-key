// At a shown 4.7 or 4.8, only a typed average can plan a climb, so keep the field open
// with no automatic fallback. Commit on Enter or blur and explain clamping.

import { useRef } from 'react'
import { Star } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { RatingFigure } from '#/components/ui/rating-figure'
import { averageSourceText, averageWhyText } from './rating-goal-setup-copy'
import type { SetupPlan } from './rating-goal-setup-draft'
import { RatingGoalClampNote, RatingGoalTypedNumber } from './rating-goal-typed-number'
import { tenthsText } from './rating-goal-view'

type Props = Readonly<{
  plan: SetupPlan
  ownOn: boolean
  message: string | undefined
  idBase: string
  onChange: () => void
  onBackToAutomatic: () => void
  onTypeOwn: (raw: string) => void
}>

function OwnAverageField({ plan, idBase, onTypeOwn }: Props) {
  return (
    <RatingGoalTypedNumber
      shown={tenthsText(plan.average.tenths)}
      inputMode="decimal"
      labelledBy={`${idBase}-average`}
      describedBy={`${idBase}-average-why`}
      onCommit={onTypeOwn}
    >
      <Star aria-hidden="true" className="size-4 shrink-0 fill-current text-rating" />
    </RatingGoalTypedNumber>
  )
}

export function RatingGoalAverageFact(props: Props) {
  const { plan, ownOn, idBase } = props
  const { average } = plan
  const earlier = average.source === 'earlier' && !ownOn
  const changeRef = useRef<HTMLButtonElement>(null)
  // The second "Back to automatic" goes once used: the focus moves to "Change",
  // which stays in place.
  const backFromEarlier = () => {
    changeRef.current?.focus()
    props.onBackToAutomatic()
  }
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap items-baseline gap-x-2" style={{ minHeight: 32 }}>
        <span
          id={`${idBase}-average`}
          className="text-sm whitespace-nowrap text-muted-foreground"
        >
          New reviews planned at
        </span>
        {ownOn ? (
          <OwnAverageField {...props} />
        ) : (
          <RatingFigure value={average.tenths / 10} size="md" className="font-semibold" />
        )}
        <span className="text-sm text-muted-foreground">
          {averageSourceText(average, plan.goal.shownTenths)}
        </span>
        <span className="ms-auto inline-flex gap-3">
          {ownOn && average.ownOnly ? null : (
            <Button
              ref={changeRef}
              type="button"
              variant="link"
              size="inline"
              touch
              onClick={ownOn ? props.onBackToAutomatic : props.onChange}
            >
              {ownOn ? 'Back to automatic' : 'Change'}
            </Button>
          )}
          {earlier ? (
            <Button
              type="button"
              variant="link"
              size="inline"
              touch
              onClick={backFromEarlier}
            >
              Back to automatic
            </Button>
          ) : null}
        </span>
      </div>
      <p id={`${idBase}-average-why`} className="mt-0.5 text-xs text-muted-foreground">
        {props.message === undefined ? null : (
          <RatingGoalClampNote>{props.message}</RatingGoalClampNote>
        )}
        {averageWhyText(plan)}
      </p>
    </div>
  )
}
