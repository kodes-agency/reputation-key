// One empty square for each new review the card's headline counts (round 5,
// PLAN-D E7, mocks D2/D4), from 1 to 30 and only from RepKey's full copy of the
// reviews: past 30 they are noise, and under Google's rounded figure a row of
// squares would promise a count nobody knows. A picture named by its words.
import { slotsLabel } from './rating-goal-tracking-words'

export function RatingGoalSlots({ count }: Readonly<{ count: number }>) {
  if (count === 0) return null
  return (
    <div
      role="img"
      aria-label={slotsLabel(count)}
      data-slot="rating-goal-slots"
      className="flex max-w-md flex-wrap gap-1"
    >
      {Array.from({ length: count }, (_, at) => (
        <span
          key={at}
          className="size-4 rounded-sm border-2 border-dashed border-primary"
        />
      ))}
    </div>
  )
}
