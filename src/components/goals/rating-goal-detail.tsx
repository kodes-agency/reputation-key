// The Google rating goal's detail page: the full monitoring view, one click from
// the simple card (ADR 0067, decision 7). What Google shows against the goal and
// the chosen pace; the forecast at that pace and at the pace of the last four
// weeks, and the best case; the bar from where the goal started with the next
// tenth marked; this week, the last four weeks and what is still needed; the
// weekly bars against the pace; the stars since it was set; the change log.
import { lazy, Suspense } from 'react'
import { Link } from '@tanstack/react-router'
import { Target } from 'lucide-react'
import type {
  RatingGoalDetailView,
  RatingGoalSetupView,
} from '#/contexts/reporting/application/dto/rating-goal.types'
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
  cantReachSuggestion,
  detailForecasts,
  nextTenthLine,
  progressMarks,
} from './rating-goal-detail-view'
import {
  endedSentence,
  exactProgressText,
  perMonthAndDay,
  ratingText,
} from './rating-goal-view'

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
  /** The setup read, for the fix suggested when no pace reaches the target. */
  setup?: RatingGoalSetupView
  personName: (userId: string) => string | null
}>

const QUIET = 'text-sm text-muted-foreground'

function Summary({ detail, timezone, now, setup }: Props) {
  const target = ratingText(detail.target)
  const best = bestCaseLine(detail)
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
        {detail.pacePerWeek === null ? null : (
          <p className="text-base">
            Your pace: {detail.pacePerWeek} a week ·{' '}
            {perMonthAndDay(ratingGoalPaceView(detail.pacePerWeek))}
          </p>
        )}
        {detail.googleShowsSoon ? (
          <Alert variant="info">
            <AlertDescription>
              Google should show {target} soon. Its number can take up to two weeks to
              catch up.
            </AlertDescription>
          </Alert>
        ) : null}
        {detail.status === 'cant_reach_at_mix' ? (
          <Alert variant="warning">
            <AlertDescription>
              {cantReachSuggestion(detail.target, setup)}
            </AlertDescription>
          </Alert>
        ) : null}
        {detailForecasts(detail).length === 0 ? null : (
          <DescriptionList stacked aria-label="When Google is expected to show it">
            {detailForecasts(detail).map((line) => (
              <DescriptionItem key={line.label} term={line.label}>
                {line.text}
              </DescriptionItem>
            ))}
          </DescriptionList>
        )}
        {best === null ? null : <p className={QUIET}>{best}</p>}
      </CardContent>
    </Card>
  )
}

function Progress({ detail }: Pick<Props, 'detail'>) {
  if (detail.progress === null) return null
  const marks = progressMarks(detail)
  const next = nextTenthLine(detail)
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
          valueText={`Exact average ${exactProgressText(detail.exactAverage, detail.threshold)}`}
        />
        <div className="flex justify-between gap-4 text-xs text-muted-foreground tabular-nums">
          <span>{marks.start}</span>
          <span>{marks.end}</span>
        </div>
        <p className="text-sm tabular-nums">
          Exact average {exactProgressText(detail.exactAverage, detail.threshold)}
        </p>
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

export function RatingGoalDetail(props: Props) {
  const { detail } = props
  return (
    <div data-slot="rating-goal-detail" className="flex flex-col gap-6">
      {detail.state === 'reached' ? (
        <Alert variant="success">
          <AlertDescription>
            Google shows {ratingText(detail.target)}: the goal is reached. It is in
            History now, and you can set your next goal on the Goals page.
          </AlertDescription>
        </Alert>
      ) : detail.state === 'ended' ? (
        <Alert variant="info">
          <AlertDescription>
            {endedSentence(detail.endedReason)}. It is in History now, and you can set a
            new goal on the Goals page.
          </AlertDescription>
        </Alert>
      ) : null}
      <Summary {...props} />
      <Progress detail={detail} />
      <RatingGoalTiles detail={detail} />
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
