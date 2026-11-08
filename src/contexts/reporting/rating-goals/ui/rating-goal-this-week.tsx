// Plans read per day, but progress counts from Monday in the Property's week. After the
// initial period, show actual pace from the last four weeks.

import type { RatingGoalCardView } from '#/contexts/reporting/rating-goals/contracts'
import { GoalMeter } from '#/components/goals/goal-meter'
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
