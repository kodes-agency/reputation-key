// "This week" on the Google rating goal card (R3-7: the plan reads per day,
// progress is counted per week): the reviews since Monday against the plan's
// week, a bar with no verdict, the day of the Property week and, once the goal
// works at its actual pace, the last four weeks. While the goal is new, the aim
// a day instead.
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { GoalMeter } from './goal-meter'
import { thisWeekOf } from './rating-goal-tracking-words'

export function RatingGoalThisWeek({ card }: Readonly<{ card: RatingGoalCardView }>) {
  const week = thisWeekOf(card)
  if (week === null) return null
  if (week.kind === 'aim') return <p className="text-sm">{week.text}</p>
  return (
    <GoalMeter
      slot="rating-goal-this-week"
      caption="This week"
      figure={week.value}
      bar={{
        value: week.count,
        max: week.target,
        label: 'New reviews this week',
        valueText: week.valueText,
      }}
      foot={week.foot}
    />
  )
}
