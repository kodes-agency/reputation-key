import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { ReviewAnalysisProgress } from '#/contexts/ai/application/public-api'
import { formatNumber, formatTimestamp } from '#/lib/format'

type Props = Readonly<{
  progress: ReviewAnalysisProgress | undefined
}>

/** How the two counting states read as a pill; the setup flow adds its own around them. */
export const REVIEW_ANALYSIS_STATUS: StatusMap<'analysing' | 'caught_up'> = {
  analysing: { label: 'Analysing', tone: 'neutral' },
  caught_up: { label: 'Up to date', tone: 'positive' },
}

/** How much of the review history has been read, as a share of what exists. */
export function reviewAnalysisShare(
  progress: Extract<ReviewAnalysisProgress, { status: 'analysing' | 'caught_up' }>,
): number {
  const total =
    progress.analysed + progress.notAnalysable + progress.queued + progress.inProgress
  if (total === 0) return progress.status === 'caught_up' ? 1 : 0
  return (progress.analysed + progress.notAnalysable) / total
}

/**
 * Review Analysis is paced (ADR 0058): an import's history is read newest
 * first, up to a minute's background budget per property. This card says how
 * far it has got, so an empty insight or a missing topic chip reads as "not
 * yet", not "broken".
 */
export function ReviewAnalysisProgressCard({ progress }: Props) {
  if (progress === undefined) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle>Review analysis</CardTitle>
          <CardDescription>Checking progress…</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  if (progress.status === 'disabled') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Review analysis</CardTitle>
          <CardDescription>
            Off for this property. Turn on review analysis above to read sentiment and
            topics from its Google reviews.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const share = reviewAnalysisShare(progress)
  const waiting = progress.queued + progress.inProgress
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Review analysis</CardTitle>
        <CardDescription>
          {progress.status === 'analysing'
            ? `Reading reviews newest first. ${formatNumber(waiting)} still to go.`
            : 'Every review this property has is analysed.'}
        </CardDescription>
        <CardAction>
          <StatusBadge status={progress.status} map={REVIEW_ANALYSIS_STATUS} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          role="progressbar"
          aria-label="Reviews analysed"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${share})` }}
          />
        </div>
        <MetricStrip aria-label="Review analysis counts">
          <Metric label="Analysed">
            <MetricValue value={formatNumber(progress.analysed)} />
          </Metric>
          <Metric label="Waiting">
            <MetricValue value={formatNumber(progress.queued)} />
          </Metric>
          <Metric label="Running">
            <MetricValue value={formatNumber(progress.inProgress)} />
          </Metric>
          <Metric label="Not analysable">
            <MetricValue value={formatNumber(progress.notAnalysable)} />
          </Metric>
        </MetricStrip>
        {/* `progress` comes from a query the route does not prefetch, so this
            card never renders data on the server and the viewer's clock cannot
            disagree with a server-rendered line. */}
        <p className="text-xs text-muted-foreground">
          {progress.verifiedThroughEpochMillis === null
            ? 'Not analysable means the review has no text, is in an unsupported language, or its Google content has expired.'
            : `History verified complete ${formatTimestamp(progress.verifiedThroughEpochMillis, 'viewer')}.`}
        </p>
      </CardContent>
    </Card>
  )
}
