import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { ReviewAnalysisProgress } from '#/contexts/ai/application/public-api'

type Props = Readonly<{
  progress: ReviewAnalysisProgress | undefined
}>

const numberFormat = new Intl.NumberFormat('en')
const dateFormat = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

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
 * Review Analysis is paced (ADR 0058): an import's history is read a few
 * reviews a minute, newest first. This card says how far it has got, so an
 * empty insight or a missing topic chip reads as "not yet", not "broken".
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
            ? `Reading reviews newest first. ${numberFormat.format(waiting)} still to go.`
            : 'Every review this property has is analysed.'}
        </CardDescription>
        <CardAction>
          <Badge variant={progress.status === 'caught_up' ? 'secondary' : 'outline'}>
            {progress.status === 'caught_up' ? 'Up to date' : 'Analysing'}
          </Badge>
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
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Analysed</dt>
            <dd className="text-lg font-medium tabular-nums">
              {numberFormat.format(progress.analysed)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Waiting</dt>
            <dd className="text-lg font-medium tabular-nums">
              {numberFormat.format(progress.queued)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Running</dt>
            <dd className="text-lg font-medium tabular-nums">
              {numberFormat.format(progress.inProgress)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Not analysable</dt>
            <dd className="text-lg font-medium tabular-nums">
              {numberFormat.format(progress.notAnalysable)}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {progress.verifiedThroughEpochMillis === null
            ? 'Not analysable means the review has no text, is in an unsupported language, or its Google content has expired.'
            : `History verified complete ${dateFormat.format(progress.verifiedThroughEpochMillis)}.`}
        </p>
      </CardContent>
    </Card>
  )
}
