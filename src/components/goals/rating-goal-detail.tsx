// The Google rating goal's detail page, one click from its card (ADR 0067,
// decision 7; round 5, PLAN-D D-2, mock D3): the card's headline with when the
// goal arrives and where Google stands; "The climb, step by step", a chart of
// the exact average against the plan and the likely band; "Your plan, so
// far"; and "What moved you", in words. A goal the read found reached or
// ended says so first and looks forward no more: no time, no likely band.
import { lazy, Suspense } from 'react'
import { Link } from '@tanstack/react-router'
import { Target } from 'lucide-react'
import type { RatingGoalDetailView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { climbChartModel, type ClimbChartModel } from './rating-goal-climb-chart-view'
import { RatingGoalDetailHeader } from './rating-goal-detail-header'
import { RatingGoalMovedList } from './rating-goal-moved-list'
import { RatingGoalPlanSoFar } from './rating-goal-plan-so-far'
import { endedSentence, ratingText } from './rating-goal-view'

// Recharts is a chunk of its own, loaded once the page is up.
const RatingGoalClimbChart = lazy(() =>
  import('./rating-goal-climb-chart').then((module) => ({
    default: module.RatingGoalClimbChart,
  })),
)

type Props = Readonly<{
  /** The low reviews open in this Property's Inbox. */
  propertyId: string
  detail: RatingGoalDetailView
  /** When the detail was read: Google's numbers are "checked N minutes ago" from it. */
  readAt: Date
  timezone: string
  now: Date
  personName: (userId: string) => string | null
}>

/** One key of the chart: a swatch and its words. */
function Key({ swatch, children }: Readonly<{ swatch: string; children: string }>) {
  return (
    <li className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={swatch} />
      {children}
    </li>
  )
}

/** The chart's key: only what it draws. */
function Legend({ model }: Readonly<{ model: ClimbChartModel }>) {
  const { chart } = model
  return (
    <ul
      aria-label="Chart key"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {chart.history === null ? null : (
        <Key swatch="h-1 w-4 rounded-full bg-foreground">Google’s exact average</Key>
      )}
      {chart.plan.length === 0 ? null : (
        <Key swatch="h-3 w-4 rounded-sm border border-dashed border-primary">
          Your plan
        </Key>
      )}
      {chart.likely.length === 0 ? null : (
        <Key swatch="h-3 w-4 rounded-sm bg-link opacity-50">Likely</Key>
      )}
    </ul>
  )
}

/**
 * While recharts loads: the chart's caption (its text alternative, there from
 * the first paint) above a block of the chart's height, as ChartFrame lays
 * them out, so nothing below moves when the chart arrives.
 */
function ClimbPending({ caption }: Readonly<{ caption: string }>) {
  return (
    <figure className="min-w-0 space-y-2">
      <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>
      <Skeleton aria-hidden="true" className="h-60 w-full" />
    </figure>
  )
}

function Climb({ model }: Readonly<{ model: ClimbChartModel }>) {
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <CardTitle as="h2">The climb, step by step</CardTitle>
        <Legend model={model} />
      </CardHeader>
      <CardContent>
        <Suspense fallback={<ClimbPending caption={model.caption} />}>
          <RatingGoalClimbChart model={model} />
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
  const model = climbChartModel(detail)
  return (
    <div data-slot="rating-goal-detail" className="flex flex-col gap-6">
      <Moved detail={detail} />
      <RatingGoalDetailHeader detail={detail} timezone={props.timezone} now={props.now} />
      {model === null ? null : <Climb model={model} />}
      <RatingGoalPlanSoFar detail={detail} />
      <RatingGoalMovedList
        propertyId={props.propertyId}
        detail={detail}
        readAt={props.readAt}
        personName={props.personName}
        timezone={props.timezone}
        now={props.now}
      />
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
