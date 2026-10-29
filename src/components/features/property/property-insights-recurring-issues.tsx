import type {
  AiPropertyInsightsAllTimeReady,
  AiPropertyInsightsPresetReady,
} from '#/contexts/ai/application/public-api'
import { formatNumber } from '#/lib/format'

type PropertyInsightsEvidence =
  AiPropertyInsightsAllTimeReady | AiPropertyInsightsPresetReady

/**
 * Specific problems two or more reviews in the window name. The read model
 * has already dropped the ones a single review names: one guest's complaint
 * is not a pattern, and a count of one next to a "+1" badge read like one.
 */
export function PropertyInsightsRecurringIssues({
  evidence,
}: Readonly<{ evidence: PropertyInsightsEvidence }>) {
  if (evidence.basis.analyzedReviewCount + evidence.basis.preAspectAnalysisCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no analysed reviews with text in this period, so recurring issues cannot
        be assessed.
      </p>
    )
  }
  if (evidence.emergingIssues.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No issue was named in more than one review in this period.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {evidence.emergingIssues.map((issue) => (
        <li
          key={issue.label}
          className="flex min-h-11 items-center justify-between gap-4 rounded-lg border px-4 py-3"
        >
          <span className="min-w-0 text-sm font-medium">{issue.label}</span>
          <span className="shrink-0 text-sm tabular-nums">
            <span className="font-semibold">{formatNumber(issue.count)}</span> reviews
          </span>
        </li>
      ))}
    </ul>
  )
}
