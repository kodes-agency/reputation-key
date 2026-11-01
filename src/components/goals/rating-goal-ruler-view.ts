// The Google rating goal on the goal ruler (2026-11-01, ADR 0067): from what Google
// showed when the goal was set to the goal, the tenths on the way as stops, and
// where the exact average stands today. A tenth's stop sits at the average at which
// Google shows it, so the bar reaches a stop when Google can show that number, and
// a manager never sees 4.02 or 4.05. Pure.
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { rulerModel, type GoalRulerModel } from './goal-ruler-view'
import { reviewCountText } from './rating-goal-tracking-words'
import { tenthsText } from './rating-goal-view'

const tenthsOf = (rating: number): number => Math.round(rating * 10)

/** More stops than this say their numbers alone, so their words never touch. */
const STOPS_WITH_NOTES = 2

/** How far along the goal is: reached (or earned) is the whole way. */
function shareOf(card: RatingGoalCardView): number {
  if (card.state === 'reached' || card.googleShowsSoon) return 1
  const from = card.baseline.exactAverage
  const span = card.threshold - from
  if (span <= 0) return 1
  return ((card.exactAverage ?? from) - from) / span
}

/** "Started at 3.9. Google shows 4.0 now. Your goal is 4.1." */
function sentence(card: RatingGoalCardView, shown: number, start: number): string {
  const goal = tenthsText(card.targetTenths)
  if (card.state === 'reached') return `Started at ${tenthsText(start)}. Reached ${goal}.`
  const now =
    card.google?.current === false
      ? `Google showed ${tenthsText(shown)} last.`
      : `Google shows ${tenthsText(shown)} now.`
  const started = start < shown ? `Started at ${tenthsText(start)}. ` : ''
  return `${started}${now} Your goal is ${goal}.`
}

function stopsOf(card: RatingGoalCardView, shown: number, start: number) {
  const offset = card.target - card.threshold
  const from = card.baseline.exactAverage
  const span = card.threshold - from
  const tenths = Array.from(
    { length: Math.max(0, card.targetTenths - start - 1) },
    (_, index) => start + 1 + index,
  )
  const next = card.next
  return tenths.map((tenth) => {
    const isNext = next?.targetTenths === tenth
    const countWords =
      next === null
        ? null
        : reviewCountText(next.reviewsNeeded, card.exactAverageSource === 'google')
    const note = isNext ? countWords : tenth <= shown ? 'reached' : null
    return {
      key: String(tenth),
      at: span <= 0 ? 1 : (tenth / 10 - offset - from) / span,
      value: tenthsText(tenth),
      note: isNext || tenths.length <= STOPS_WITH_NOTES ? note : null,
    }
  })
}

/** Null for a goal to keep a number, or before Google has sent a number. */
export function ratingGoalRuler(card: RatingGoalCardView): GoalRulerModel | null {
  const shows = card.google?.shows
  if (card.mode === 'keep' || shows === null || shows === undefined) return null
  const shown = tenthsOf(shows)
  const start = tenthsOf(card.baseline.googleShows)
  return rulerModel({
    label: sentence(card, shown, start),
    from: { value: tenthsText(start), note: 'started' },
    to: {
      value: tenthsText(card.targetTenths),
      note: card.state === 'reached' ? 'reached' : 'your goal',
    },
    at: shareOf(card),
    now: 'Today',
    stops: stopsOf(card, shown, start),
    reached: card.state === 'reached',
  })
}
