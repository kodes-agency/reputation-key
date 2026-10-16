// The top of the Google rating goal's detail page (round 5, PLAN-D D-2, mock
// D3): the card's headline ("18 new reviews to 4.1", with "Google should show
// 4.4 soon" beside it), when the goal arrives at the card's own pace and where
// Google stands against where it started, the number possible after it, and
// what is in the way (Google lagging on the goal, new reviews too low, stale
// numbers). The page's one h1 stays the page header's; this is a paragraph.
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { RatingGoalClimbHeadline } from './rating-goal-climb-headline'
import { PLAN_POLICY_LINE } from './rating-goal-copy'
import { detailHeaderLines } from './rating-goal-detail-view'
import { RatingGoalHeadline } from './rating-goal-headline'
import { goalLineText, soonText } from './rating-goal-tracking-words'
import {
  APPROXIMATE_NUMBERS,
  googleShows,
  ratingText,
  reviewsTooLowSentence,
  waitingSentence,
} from './rating-goal-view'

type Props = Readonly<{
  detail: RatingGoalDetailView
  /** The Property's zone: a stale number's date is on its clock. */
  timezone: string
  now: Date
}>

const QUIET = 'text-sm text-muted-foreground'

/** What stands in the climb's way, said once with what helps. */
function Outlook({ detail, timezone, now }: Props) {
  if (detail.state !== 'active') return null
  if (detail.status === 'waiting_for_google') {
    const asOf = googleShows(detail.google, timezone, now).asOf
    return (
      <>
        {asOf === null ? null : <p className={QUIET}>{asOf}</p>}
        <p className={QUIET}>{waitingSentence(detail.google, timezone, now)}</p>
      </>
    )
  }
  if (detail.status === 'reviews_too_low') {
    // What helps: the approved words on how guests are asked (R2-12).
    return (
      <Alert variant="warning">
        <AlertDescription>
          {reviewsTooLowSentence(detail.target)} {PLAN_POLICY_LINE}
        </AlertDescription>
      </Alert>
    )
  }
  if (detail.googleShowsSoon) {
    return (
      <Alert variant="info">
        <AlertDescription>
          Your reviews already clear {ratingText(detail.target)}. Google’s number can take
          up to two weeks to catch up.
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

function ClimbHeader(props: Props) {
  const { detail } = props
  const lines = detailHeaderLines(detail)
  const soon = soonText(detail)
  const goal = goalLineText(detail)
  const said = [lines.arrival, lines.started].filter((line) => line !== null)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <RatingGoalClimbHeadline card={detail} />
        {soon === null ? null : <p className="text-sm">{soon}</p>}
      </div>
      {goal === null ? null : <p className={QUIET}>{goal}</p>}
      {said.length === 0 ? null : <p className="text-base">{said.join(' ')}</p>}
      {lines.possible === null ? null : <p className={QUIET}>{lines.possible}</p>}
      {lines.otherPace === null ? null : <p className={QUIET}>{lines.otherPace}</p>}
      {detail.exactAverageSource === 'google' ? (
        <p className={QUIET}>{APPROXIMATE_NUMBERS}</p>
      ) : null}
      <Outlook {...props} />
    </div>
  )
}

export function RatingGoalDetailHeader(props: Props) {
  if (props.detail.mode === 'keep') {
    return (
      <RatingGoalHeadline card={props.detail} timezone={props.timezone} now={props.now} />
    )
  }
  return <ClimbHeader {...props} />
}
