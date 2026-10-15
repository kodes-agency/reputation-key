// The Google rating goal's detail page: the full monitoring view, one click from
// the simple card (ADR 0067, decision 7). What Google shows against the goal;
// "Your plan" against what happened since it was set (round 2, R2-11); the
// forecast at the chosen pace and at the pace of the last four weeks, and the
// best case; the bar from where the goal started with the next
// tenth marked; this week, the last four weeks and what is still needed; the
// weekly bars against the pace; the stars since it was set; the change log.
// A goal the read found reached or ended looks forward no more: what it was,
// the weeks, the stars and the changes stay, the forecasts and the bar go.
import { lazy, Suspense } from 'react'
import { Link } from '@tanstack/react-router'
import { Target } from 'lucide-react'
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { ratingGoalPaceView } from '#/contexts/reporting/application/rating-goal-preview'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { EmptyState } from '#/components/ui/empty-state'
import { ProgressBar } from '#/components/ui/progress-bar'
import { Skeleton } from '#/components/ui/skeleton'
import { RatingGoalHeadline } from './rating-goal-card'
import {
  RatingGoalChangeLog,
  RatingGoalFoot,
  RatingGoalStarMix,
  RatingGoalTiles,
} from './rating-goal-detail-parts'
import {
  bestCaseLine,
  detailForecasts,
  nextTenthLine,
  progressMarks,
  yourPlanLines,
} from './rating-goal-detail-view'
import { PLAN_POLICY_LINE } from './rating-goal-plan-view'
import {
  APPROXIMATE_NUMBERS,
  averageProgressText,
  endedSentence,
  perMonthAndDay,
  ratingText,
  reviewsTooLowSentence,
} from './rating-goal-view'
import { RatingGoalWholeDates } from './rating-goal-whole-dates'

// Recharts is a chunk of its own, loaded once the page is up.
const RatingGoalWeeklyChart = lazy(() =>
  import('./rating-goal-weekly-chart').then((module) => ({
    default: module.RatingGoalWeeklyChart,
  })),
)

type Props = Readonly<{
  detail: RatingGoalDetailView
  /** When the detail was read: Google's numbers are "checked N minutes ago" from it. */
  readAt: Date
  timezone: string
  now: Date
  personName: (userId: string) => string | null
}>

const QUIET = 'text-sm text-muted-foreground'

/** "Your plan": the goal, the new reviews' average and the pace, each against the plan. */
function YourPlan({
  plan,
}: Readonly<{ plan: NonNullable<RatingGoalDetailView['plan']> }>) {
  return (
    <section aria-labelledby="rating-goal-your-plan" className="flex flex-col gap-3">
      <h3 id="rating-goal-your-plan" className="text-base font-medium">
        Your plan
      </h3>
      <DescriptionList termWidth="wide">
        {yourPlanLines(plan).map((line) => (
          <DescriptionItem key={line.term} term={line.term} note={line.note ?? undefined}>
            <span className="tabular-nums">{line.value}</span>
          </DescriptionItem>
        ))}
      </DescriptionList>
    </section>
  )
}

/** What an active goal looks forward to: its plan, the forecasts and the best case. */
function Outlook({ detail }: Pick<Props, 'detail'>) {
  const target = ratingText(detail.target)
  const best = bestCaseLine(detail)
  const forecasts = detailForecasts(detail)
  return (
    <>
      {detail.pacePerWeek === null || detail.plan !== null ? null : (
        <p className="text-base">
          Your pace: {detail.pacePerWeek} a week ·{' '}
          {perMonthAndDay(ratingGoalPaceView(detail.pacePerWeek))}
        </p>
      )}
      {detail.googleShowsSoon ? (
        <Alert variant="info">
          <AlertDescription>
            Google should show {target} soon. Its number can take up to two weeks to catch
            up.
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.status === 'reviews_too_low' ? (
        // What helps: the approved words on how guests are asked (R2-12).
        <Alert variant="warning">
          <AlertDescription>
            {reviewsTooLowSentence(detail.target)} {PLAN_POLICY_LINE}
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.plan === null ? null : <YourPlan plan={detail.plan} />}
      {forecasts.length === 0 ? null : (
        <DescriptionList stacked aria-label="When Google is expected to show it">
          {forecasts.map((line) => (
            <DescriptionItem key={line.label} term={line.label}>
              <RatingGoalWholeDates text={line.text} />
            </DescriptionItem>
          ))}
        </DescriptionList>
      )}
      {best === null ? null : <p className={QUIET}>{best}</p>}
    </>
  )
}

function Summary({ detail, timezone, now }: Props) {
  const target = ratingText(detail.target)
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle as="h2">
          {detail.mode === 'keep'
            ? `Keeping ${target} on Google`
            : `Reach ${target} on Google`}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RatingGoalHeadline card={detail} timezone={timezone} now={now} />
        {detail.state === 'active' ? <Outlook detail={detail} /> : null}
      </CardContent>
    </Card>
  )
}

function Progress({ detail }: Pick<Props, 'detail'>) {
  if (detail.progress === null) return null
  const marks = progressMarks(detail)
  const next = nextTenthLine(detail)
  const approximate = detail.exactAverageSource === 'google'
  const average = averageProgressText(detail)
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle as="h2">Progress</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ProgressBar
          value={Math.round(marks.value * 1000)}
          max={1000}
          marker={marks.marker}
          label={`Progress toward Google showing ${ratingText(detail.target)}`}
          valueText={average}
        />
        <div className="flex justify-between gap-4 text-xs text-muted-foreground tabular-nums">
          <span>{marks.start}</span>
          <span>{marks.end}</span>
        </div>
        <p className="text-sm tabular-nums">{average}</p>
        {approximate ? <p className={QUIET}>{APPROXIMATE_NUMBERS}</p> : null}
        {next === null ? null : <p className={QUIET}>{next}</p>}
      </CardContent>
    </Card>
  )
}

function WeeklyBars({ detail }: Pick<Props, 'detail'>) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle as="h2">New Google reviews each week</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<Skeleton aria-hidden="true" className="h-60 w-full" />}>
          <RatingGoalWeeklyChart weeks={detail.weeks} pacePerWeek={detail.pacePerWeek} />
        </Suspense>
      </CardContent>
    </Card>
  )
}

/** Said once, first, when the read found the goal reached or ended. */
function Moved({ detail }: Pick<Props, 'detail'>) {
  if (detail.state === 'reached') {
    return (
      <Alert variant="success">
        <AlertDescription>
          Google shows {ratingText(detail.target)}: the goal is reached. It is in History
          now, and you can set your next goal on the Goals page.
        </AlertDescription>
      </Alert>
    )
  }
  if (detail.state === 'ended') {
    return (
      <Alert variant="info">
        <AlertDescription>
          {endedSentence(detail.endedReason)}. It is in History now, and you can set a new
          goal on the Goals page.
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

export function RatingGoalDetail(props: Props) {
  const { detail } = props
  const active = detail.state === 'active'
  return (
    <div data-slot="rating-goal-detail" className="flex flex-col gap-6">
      <Moved detail={detail} />
      <Summary {...props} />
      {active ? <Progress detail={detail} /> : null}
      {active ? <RatingGoalTiles detail={detail} /> : null}
      <WeeklyBars detail={detail} />
      <RatingGoalStarMix detail={detail} />
      <RatingGoalChangeLog
        detail={detail}
        personName={props.personName}
        timezone={props.timezone}
        now={props.now}
      />
      <RatingGoalFoot detail={detail} readAt={props.readAt} />
    </div>
  )
}

/** The page of a Property with no active rating goal: the way back to set one. */
export function RatingGoalMissing({ propertyId }: Readonly<{ propertyId: string }>) {
  return (
    <EmptyState
      icon={Target}
      title="This property has no Google rating goal"
      description="Set one on the Goals page."
      action={
        <Button asChild variant="outline">
          <Link to="/properties/$propertyId/goals" params={{ propertyId }}>
            Go to goals
          </Link>
        </Button>
      }
    />
  )
}
