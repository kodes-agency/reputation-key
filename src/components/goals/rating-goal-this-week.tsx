// "This week" on the Google rating goal card (R3-7: the plan reads per day,
// progress is counted per week): the reviews since Monday against the plan's
// week, a bar with no verdict, the day of the Property week and, once the goal
// works at its actual pace, the last four weeks. While the goal is new, the aim
// a day instead. Drawn only on a card at least 48rem wide (D2): a narrower one
// says this week in the card's one line (D4).
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { ProgressBar } from '#/components/ui/progress-bar'
import { thisWeekOf } from './rating-goal-tracking-words'

export function RatingGoalThisWeek({ card }: Readonly<{ card: RatingGoalCardView }>) {
  const week = thisWeekOf(card)
  if (week === null) return null
  if (week.kind === 'aim') return <p className="hidden text-sm @3xl:block">{week.text}</p>
  return (
    <div data-slot="rating-goal-this-week" className="hidden flex-col gap-1.5 @3xl:flex">
      <p className="text-sm text-muted-foreground">This week</p>
      <p className="text-lg font-semibold tabular-nums">{week.value}</p>
      <ProgressBar
        value={week.count}
        max={week.target}
        label="New reviews this week"
        valueText={week.valueText}
      />
      <p className="text-xs text-muted-foreground">{week.foot}</p>
    </div>
  )
}
