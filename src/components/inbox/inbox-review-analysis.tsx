import { Badge } from '#/components/ui/badge'
import type { InboxReviewAnalysis } from '#/contexts/inbox/application/public-api'
import { formatDateTime } from './utils'
import { AI_CATEGORY_LABELS } from '#/shared/ai-category-labels'

export function InboxReviewAnalysisPanel({
  analysis,
}: Readonly<{ analysis: InboxReviewAnalysis | null }>) {
  if (!analysis || analysis.status === 'disabled') return null

  if (analysis.status === 'none') {
    return (
      <section aria-label="AI review analysis" className="rounded-lg border p-3">
        <p className="text-sm font-medium">AI review signals</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Analysis is pending for this review.
        </p>
      </section>
    )
  }

  if (analysis.status === 'unavailable') {
    return (
      <section aria-label="AI review analysis" className="rounded-lg border p-3">
        <p className="text-sm font-medium">AI review signals</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Analysis is unavailable for this review language.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="AI review analysis" className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-medium">AI review signals</p>
        <Badge variant={analysis.attention === 'urgent' ? 'destructive' : 'secondary'}>
          {analysis.attention} attention
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant="outline">{analysis.sentiment} sentiment</Badge>
        <Badge variant="outline">{AI_CATEGORY_LABELS[analysis.primaryCategory]}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Generated {formatDateTime(new Date(analysis.generatedAtEpochMillis))}
      </p>
    </section>
  )
}
