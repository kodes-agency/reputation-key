import { Link } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import type {
  AiPropertyInsightAspect,
  AiPropertyInsightIssue,
} from '#/contexts/ai/application/public-api'
import { cn } from '#/lib/utils'
import { ASPECT_LABELS } from '#/shared/aspect-labels'

function signedInteger(value: number): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}`
}

function signedImpact(value: number): string {
  if (value === 0) return '0.00'
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`
}

function polarityLabel(polarity: AiPropertyInsightAspect['polarity']): string {
  if (polarity === 'negative') return 'Complaints'
  if (polarity === 'positive') return 'Praise'
  return 'Neutral'
}

function polarityBadgeVariant(
  polarity: AiPropertyInsightAspect['polarity'],
): 'destructive' | 'default' | 'outline' {
  if (polarity === 'negative') return 'destructive'
  if (polarity === 'positive') return 'default'
  return 'outline'
}

export function PropertyInsightsAspectTable({
  propertyId,
  aspects,
  analyzedReviewCount,
  comparisonAvailable,
}: Readonly<{
  propertyId: string
  aspects: readonly AiPropertyInsightAspect[]
  analyzedReviewCount: number
  comparisonAvailable: boolean
}>) {
  if (analyzedReviewCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no analysed text reviews in this period, so aspect mentions and impact
        cannot be reported.
      </p>
    )
  }
  if (aspects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No aspect mentions were identified among the analysed reviews in this period.
      </p>
    )
  }

  const busiest = aspects.reduce(
    (maximum, aspect) => Math.max(maximum, aspect.mentionCount),
    1,
  )
  const strongestImpact = aspects.reduce(
    (maximum, aspect) => Math.max(maximum, Math.abs(aspect.impact)),
    1,
  )

  return (
    <div className="min-w-0">
      <div
        aria-hidden="true"
        className={cn(
          'mb-2 hidden gap-5 border-b px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid',
          comparisonAvailable
            ? 'grid-cols-[minmax(11rem,1.45fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)]'
            : 'grid-cols-[minmax(11rem,1.45fr)_minmax(8rem,1fr)_minmax(8rem,1fr)]',
        )}
      >
        <span>Aspect</span>
        <span>Mentions</span>
        <span>Weighted impact</span>
        {comparisonAvailable && <span>Change vs previous</span>}
      </div>
      <ul className="flex min-w-0 flex-col gap-1">
        {aspects.map((aspect) => {
          const countWidth =
            aspect.mentionCount === 0 ? 0 : (aspect.mentionCount / busiest) * 100
          const impactWidth =
            aspect.impact === 0 ? 0 : (Math.abs(aspect.impact) / strongestImpact) * 100
          return (
            <li key={`${aspect.aspect}:${aspect.polarity}`} className="min-w-0">
              <Link
                to="/inbox"
                search={{
                  propertyId,
                  aspect: aspect.aspect,
                  polarity: aspect.polarity,
                }}
                className={cn(
                  'group grid min-h-11 min-w-0 gap-3 rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:items-center md:gap-5',
                  comparisonAvailable
                    ? 'md:grid-cols-[minmax(11rem,1.45fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)]'
                    : 'md:grid-cols-[minmax(11rem,1.45fr)_minmax(8rem,1fr)_minmax(8rem,1fr)]',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {ASPECT_LABELS[aspect.aspect]}
                  </span>
                  <Badge variant={polarityBadgeVariant(aspect.polarity)}>
                    {polarityLabel(aspect.polarity)}
                  </Badge>
                </span>

                <span className="min-w-0">
                  <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground md:sr-only">
                    <span>Mentions</span>
                    <span>{aspect.mentionCount}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="hidden w-7 shrink-0 text-sm font-medium tabular-nums md:inline">
                      {aspect.mentionCount}
                    </span>
                    <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-[var(--chart-1)]"
                        style={{ width: `${countWidth}%` }}
                      />
                    </span>
                  </span>
                </span>

                <span className="min-w-0">
                  <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground md:sr-only">
                    <span>Weighted impact</span>
                    <span>{signedImpact(aspect.impact)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="hidden w-12 shrink-0 text-sm font-medium tabular-nums md:inline">
                      {signedImpact(aspect.impact)}
                    </span>
                    <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          'block h-full rounded-full',
                          aspect.polarity === 'negative'
                            ? 'bg-destructive'
                            : aspect.polarity === 'positive'
                              ? 'bg-primary'
                              : 'bg-muted-foreground',
                        )}
                        style={{ width: `${impactWidth}%` }}
                      />
                    </span>
                  </span>
                </span>

                {comparisonAvailable && aspect.comparison !== null && (
                  <>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
                      <span>
                        {signedInteger(aspect.comparison.mentionCountDelta)}{' '}
                        {Math.abs(aspect.comparison.mentionCountDelta) === 1
                          ? 'mention'
                          : 'mentions'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{signedImpact(aspect.comparison.impactDelta)} impact</span>
                    </span>
                    <span className="sr-only">
                      Previous period: {aspect.comparison.precedingMentionCount} mentions
                      and {signedImpact(aspect.comparison.precedingImpact)} weighted
                      impact. Open matching reviews in the inbox.
                    </span>
                  </>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function PropertyInsightsEmergingIssues({
  issues,
  analyzedReviewCount,
  comparisonAvailable,
}: Readonly<{
  issues: readonly AiPropertyInsightIssue[]
  analyzedReviewCount: number
  comparisonAvailable: boolean
}>) {
  if (analyzedReviewCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no analysed text reviews in this period, so emerging issues cannot be
        assessed.
      </p>
    )
  }
  if (issues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recurring issue labels were found among the analysed reviews in this period.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {issues.map((issue) => (
        <li
          key={issue.label}
          className="flex min-h-11 items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5"
        >
          <span className="min-w-0 truncate text-sm font-medium">{issue.label}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">
              {issue.count}
              <span className="sr-only"> {issue.count === 1 ? 'review' : 'reviews'}</span>
            </span>
            {comparisonAvailable && issue.comparison !== null && (
              <Badge
                variant={
                  issue.comparison.delta > 0
                    ? 'destructive'
                    : issue.comparison.delta < 0
                      ? 'secondary'
                      : 'outline'
                }
              >
                {issue.comparison.delta === 0
                  ? 'No change'
                  : `${signedInteger(issue.comparison.delta)} vs previous`}
              </Badge>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
