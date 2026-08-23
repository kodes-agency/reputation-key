import { AlertTriangle, CircleGauge, Tag } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { InboxReviewAnalysis } from '#/contexts/inbox/application/public-api'
import { AI_CATEGORY_LABELS } from '#/shared/ai-category-labels'

export function InboxReviewAnalysisPanel({
  analysis,
}: Readonly<{ analysis: InboxReviewAnalysis | null }>) {
  if (!analysis || analysis.status === 'disabled') return null
  if (analysis.status === 'none' || analysis.status === 'unavailable') {
    return (
      <p aria-label="AI review analysis" className="text-xs text-muted-foreground">
        {analysis.status === 'none'
          ? 'Review signals are being analyzed.'
          : 'Review signals are unavailable for this language.'}
      </p>
    )
  }

  return (
    <section aria-label="AI review analysis" className="flex flex-wrap gap-2">
      <Badge variant="outline" className="font-normal text-muted-foreground">
        <CircleGauge />
        {analysis.sentiment[0].toUpperCase() + analysis.sentiment.slice(1)} sentiment
      </Badge>
      <Badge variant="outline" className="font-normal text-muted-foreground">
        <Tag />
        {AI_CATEGORY_LABELS[analysis.primaryCategory]}
      </Badge>
      <Badge
        variant={analysis.attention === 'urgent' ? 'destructive' : 'outline'}
        className="font-normal"
      >
        <AlertTriangle />
        {analysis.attention[0].toUpperCase() + analysis.attention.slice(1)} attention
      </Badge>
    </section>
  )
}
