import { AlertTriangle, ArrowDown, ArrowUp } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { cn } from '#/lib/utils'
import { ASPECT_LABELS } from '#/shared/aspect-labels'
import { INBOX_CHIP_STATIC_CLASS } from './inbox-chip'
import type { ReactNode } from 'react'
import type {
  InboxReviewAnalysis,
  ReviewAnalysisAspect,
  ReviewAspectPolarity,
} from '#/contexts/inbox/application/public-api'

/**
 * The dashboard settled on Praise / Complaint (plan rows 6, 11) but neither
 * shared table says that: `ASPECT_POLARITY_LABELS` still says Positive /
 * Negative, and `ASPECT_POLARITY_OPTIONS` pluralises ("Complaints") because it
 * labels a filter spanning many reviews. One chip describes one mention, so the
 * word is singular and the map lives here until the shared table catches up.
 */
const POLARITY_WORD: Readonly<Record<ReviewAspectPolarity, string>> = Object.freeze({
  positive: 'Praise',
  neutral: 'Neutral',
  negative: 'Complaint',
})

/**
 * Direction colour never carries meaning alone (plan row 11, dashboard row 10):
 * every tinted chip also prints its arrow and its polarity word. A neutral
 * mention gets no tint and no arrow, because there is no direction to show.
 */
const POLARITY_CLASS: Readonly<Record<ReviewAspectPolarity, string>> = Object.freeze({
  positive: 'bg-positive-muted text-positive',
  neutral: '',
  negative: 'bg-negative-muted text-negative',
})

/** Verbatim from the list row's urgent chip, so the two surfaces agree. */
const ATTENTION_CLASS = 'border-destructive/20 bg-destructive/10 text-destructive'

function PolarityArrow({
  polarity,
}: Readonly<{ polarity: ReviewAspectPolarity }>): ReactNode {
  if (polarity === 'positive') return <ArrowUp aria-hidden="true" />
  if (polarity === 'negative') return <ArrowDown aria-hidden="true" />
  return null
}

function AspectChip({ aspect }: Readonly<{ aspect: ReviewAnalysisAspect }>): ReactNode {
  const tinted = aspect.polarity !== 'neutral'
  return (
    <Badge
      variant={tinted ? 'secondary' : 'outline'}
      className={cn(
        INBOX_CHIP_STATIC_CLASS,
        'font-normal',
        POLARITY_CLASS[aspect.polarity],
      )}
    >
      <PolarityArrow polarity={aspect.polarity} />
      {ASPECT_LABELS[aspect.aspect]} · {POLARITY_WORD[aspect.polarity]}
    </Badge>
  )
}

/**
 * What the review is about, in the dashboard's vocabulary. The sentiment chip
 * the old analysis panel led with is gone: a chip per mentioned topic already
 * says which way each one points, and one summary word over the top of them
 * only disagreed with the detail underneath it.
 */
export function TopicChips({
  analysis,
}: Readonly<{ analysis: InboxReviewAnalysis | null }>): ReactNode {
  if (!analysis || analysis.status === 'disabled') return null

  // `none` is not "in progress". The adapter returns it for a review whose
  // content has expired — it will never be analysed again — as well as for a
  // stale profile or a fence mismatch, so the line must promise no work: on an
  // expired review it renders directly under `Review content unavailable
  // (source cache expired)`, and "being analyzed" contradicted it outright.
  if (analysis.status === 'none' || analysis.status === 'unavailable') {
    return (
      <p className="text-xs text-muted-foreground">
        {analysis.status === 'none'
          ? 'No review signals for this review.'
          : 'Review signals are unavailable for this language.'}
      </p>
    )
  }

  // Today only `urgent` is marked, but the attention scale keeps `high` above
  // the "worth a look" line, and one chip covers both.
  const needsAttention = analysis.attention === 'urgent' || analysis.attention === 'high'

  // A `ready` analysis may name no aspect at all. An empty `<ul>` is announced
  // as "Review topics, list, 0 items" and still takes its share of the guest
  // article's gap, so render nothing when nothing would go inside it.
  if (analysis.aspects.length === 0 && !needsAttention) return null

  return (
    <ul aria-label="Review topics" className="flex flex-wrap items-center gap-2">
      {analysis.aspects.map((aspect) => (
        <li key={`${aspect.aspect}:${aspect.polarity}`}>
          <AspectChip aspect={aspect} />
        </li>
      ))}
      {needsAttention && (
        <li>
          <Badge
            variant="outline"
            className={cn(INBOX_CHIP_STATIC_CLASS, 'font-normal', ATTENTION_CLASS)}
          >
            <AlertTriangle aria-hidden="true" />
            Needs attention
          </Badge>
        </li>
      )}
    </ul>
  )
}
