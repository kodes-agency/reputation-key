// "Google shows 4.3 → your goal 4.5": the two numbers a goal to keep and the
// detail page lead with. The climb card counts to the next number instead
// (rating-goal-climb-card.tsx, round 5).
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { googleShows, ratingText } from './rating-goal-view'

/** The figure a headline leads with: large, its words around it small. */
const FIGURE = 'text-3xl leading-none font-semibold tabular-nums'
const QUIET = 'text-sm text-muted-foreground'
/** Words and their figure, kept on one line together. */
const GROUP = 'inline-flex items-baseline gap-2 whitespace-nowrap'

type Props = Readonly<{
  card: RatingGoalCardView
  /** The Property's zone: a stale number's date is on its clock. */
  timezone: string
  now: Date
}>

/**
 * Each number stays with its words, and the arrow with the first, so a narrow
 * card breaks the line after "→", never before it. A stale number's date sits
 * under them.
 */
export function RatingGoalHeadline({ card, timezone, now }: Props) {
  const shows = googleShows(card.google, timezone, now)
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={GROUP}>
          <span className={QUIET}>Google shows</span>
          <span className={FIGURE}>{shows.figure}</span>
          {card.mode === 'keep' ? null : (
            <span aria-hidden="true" className={QUIET}>
              →
            </span>
          )}
        </span>
        {card.mode === 'keep' ? null : (
          <span className={GROUP}>
            <span className={QUIET}>your goal</span>
            <span className={FIGURE}>{ratingText(card.target)}</span>
          </span>
        )}
      </p>
      {shows.asOf === null ? null : <p className={QUIET}>{shows.asOf}</p>}
    </div>
  )
}
