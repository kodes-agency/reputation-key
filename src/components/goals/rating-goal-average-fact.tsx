// "New reviews planned at 4.5★" (R4-1, R4-3): the average a plan assumes, as a
// fact with where it comes from, and "Change" behind a link for the manager
// who wants their own. A typed average is applied on Enter or when the field
// is left, clamped from its floor to 5.0 with its reason. Change plan’s
// earlier average (D30) offers both Change and Back to automatic. At a shown
// 4.7 or 4.8 only a typed average plans a climb (X1), so the field is open and
// there is no automatic one to go back to.
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
              type="button"
              variant="link"
              size="inline"
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
              onClick={props.onBackToAutomatic}
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
