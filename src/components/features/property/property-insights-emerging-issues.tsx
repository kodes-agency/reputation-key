import { Badge } from '#/components/ui/badge'
import type {
  AiPropertyInsightsAllTimeReady,
  AiPropertyInsightsPresetReady,
} from '#/contexts/ai/application/public-api'

type PropertyInsightsEvidence =
  AiPropertyInsightsAllTimeReady | AiPropertyInsightsPresetReady

function signedInteger(value: number): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}`
}

export function PropertyInsightsEmergingIssues({
  evidence,
}: Readonly<{ evidence: PropertyInsightsEvidence }>) {
  if (evidence.basis.analyzedReviewCount + evidence.basis.preAspectAnalysisCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no analysed reviews with text in this period, so emerging issues cannot
        be assessed.
      </p>
    )
  }
  if (evidence.emergingIssues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No emerging issues were found among the analysed reviews in this period.
      </p>
    )
  }

  const comparisonAvailable = evidence.range !== 'all' && !evidence.provisional
  return (
    <ul className="flex flex-col gap-2">
      {evidence.emergingIssues.map((issue) => (
        <li
          key={issue.label}
          className="flex min-h-11 items-center justify-between gap-4 rounded-lg border px-4 py-3"
        >
          <span className="min-w-0 text-sm font-medium">{issue.label}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">
              {issue.count}
              <span className="sr-only"> {issue.count === 1 ? 'review' : 'reviews'}</span>
            </span>
            {comparisonAvailable && 'comparison' in issue ? (
              <Badge
                variant={
                  issue.comparison.delta > 0
                    ? 'destructive'
                    : issue.comparison.delta < 0
                      ? 'secondary'
                      : 'outline'
                }
                aria-label={`${signedInteger(issue.comparison.delta)} compared with the previous period`}
              >
                {signedInteger(issue.comparison.delta)}
              </Badge>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}
