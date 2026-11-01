// Where the Google rating goal stands, first on its page (2026-11-01, ADR 0067): the
// card's headline ("18 new reviews to 4.1"), when the goal arrives at the card's own
// pace, and the ruler of how far along it is. A goal to keep a number says so with
// Google's number. A goal this read found reached says that, on the same ruler. The
// page's one h1 stays the page header's; these are paragraphs.
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { GoalWhere } from './goal-detail-layout'
import { GoalRuler } from './goal-ruler'
import { RatingGoalClimbHeadline } from './rating-goal-climb-headline'
import { detailHeaderLines } from './rating-goal-detail-view'
import { RatingGoalHeadline } from './rating-goal-headline'
import { ratingGoalRuler } from './rating-goal-ruler-view'
import { goalLineText, headlineOf, soonText } from './rating-goal-tracking-words'
import {
  APPROXIMATE_NUMBERS,
  googleShows,
  ratingText,
  waitingSentence,
} from './rating-goal-view'

type Props = Readonly<{
  detail: RatingGoalDetailView
  /** The Property's zone: a stale number's date is on its clock. */
  timezone: string
  now: Date
}>

const QUIET = 'text-sm text-muted-foreground'
const BIG = 'text-2xl leading-tight font-semibold'

/** Stale numbers: their day, and why the goal waits. */
function Waiting({ detail, timezone, now }: Props) {
  if (detail.status !== 'waiting_for_google') return null
  const asOf = googleShows(detail.google, timezone, now).asOf
  return (
    <>
      {asOf === null ? null : <p className={QUIET}>{asOf}</p>}
      <p className={QUIET}>{waitingSentence(detail.google, timezone, now)}</p>
    </>
  )
}

function Headline({ detail }: Pick<Props, 'detail'>) {
  const target = ratingText(detail.target)
  if (detail.state === 'reached') {
    return <p className={BIG}>Google shows {target}. You did it.</p>
  }
  if (detail.status === 'reviews_too_low' || headlineOf(detail) === null) {
    return <p className={BIG}>New reviews are too low for {target}</p>
  }
  return <RatingGoalClimbHeadline card={detail} />
}

function ClimbWhere(props: Props) {
  const { detail } = props
  const lines = detailHeaderLines(detail)
  const soon = detail.state === 'active' ? soonText(detail) : null
  const goal = detail.state === 'active' ? goalLineText(detail) : null
  const ruler = ratingGoalRuler(detail)
  return (
    <GoalWhere>
      <Headline detail={detail} />
      {soon === null ? null : <p className="text-sm">{soon}</p>}
      {goal === null ? null : <p className={QUIET}>{goal}</p>}
      {lines.arrival === null ? null : <p className="text-sm">{lines.arrival}</p>}
      {lines.otherPace === null ? null : <p className={QUIET}>{lines.otherPace}</p>}
      {detail.exactAverageSource === 'google' ? (
        <p className={QUIET}>{APPROXIMATE_NUMBERS}</p>
      ) : null}
      <Waiting {...props} />
      {ruler === null ? null : <GoalRuler model={ruler} />}
    </GoalWhere>
  )
}

export function RatingGoalDetailHeader(props: Props) {
  const { detail, timezone, now } = props
  // A goal found ended looks forward no more; the alert above the page says so.
  if (detail.state === 'ended') return null
  if (detail.mode === 'keep') {
    return (
      <GoalWhere>
        <p className={BIG}>Keeping {ratingText(detail.target)} on Google</p>
        <RatingGoalHeadline card={detail} timezone={timezone} now={now} />
      </GoalWhere>
    )
  }
  return <ClimbWhere {...props} />
}
