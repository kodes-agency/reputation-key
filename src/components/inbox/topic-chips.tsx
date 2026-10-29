import { ArrowDown, ArrowUp } from 'lucide-react'
import { Badge, type BadgeVariant } from '#/components/ui/badge'
import { cn } from '#/lib/utils'
import { ASPECT_LABELS } from '#/shared/aspect-labels'
import { INBOX_CHIP_STATIC_CLASS } from './inbox-chip'
import { prioritySuggestion, prioritySuggestionHint } from './inbox-priority-view'
import type { ReactNode } from 'react'
import type {
  InboxPriority,
  InboxReviewAnalysis,
  ReviewAnalysisAspect,
  ReviewAspectPolarity,
} from '#/contexts/inbox/application/public-api'
import type { MatchedTopic } from './use-matched-topic'

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
const POLARITY_VARIANT: Readonly<Record<ReviewAspectPolarity, BadgeVariant>> =
  Object.freeze({
    positive: 'positive',
    neutral: 'outline',
    negative: 'negative',
  })

function PolarityArrow({
  polarity,
}: Readonly<{ polarity: ReviewAspectPolarity }>): ReactNode {
  if (polarity === 'positive') return <ArrowUp aria-hidden="true" />
  if (polarity === 'negative') return <ArrowDown aria-hidden="true" />
  return null
}

/** Whether a chip is the one the Inbox was opened on: the topic, and the polarity if one was named. */
function isMatched(aspect: ReviewAnalysisAspect, matched: MatchedTopic | null): boolean {
  return (
    matched !== null &&
    aspect.aspect === matched.aspect &&
    (matched.polarity === undefined || aspect.polarity === matched.polarity)
  )
}

function AspectChip({
  aspect,
  matched,
}: Readonly<{ aspect: ReviewAnalysisAspect; matched: boolean }>): ReactNode {
  return (
    <Badge
      variant={POLARITY_VARIANT[aspect.polarity]}
      // A ring, not a colour: the chip keeps its own tone, and the line under the
      // chips says in words which one matched.
      className={cn(
        INBOX_CHIP_STATIC_CLASS,
        'font-normal',
        matched && 'ring-2 ring-ring',
      )}
    >
      <PolarityArrow polarity={aspect.polarity} />
      {ASPECT_LABELS[aspect.aspect]} · {POLARITY_WORD[aspect.polarity]}
      {matched ? (
        <span className="sr-only"> (matches the topic you followed)</span>
      ) : null}
    </Badge>
  )
}

/** "Matched: Room, complaint": what the Inbox was opened on, when this review holds it. */
function matchedLine(matched: MatchedTopic): string {
  const topic = ASPECT_LABELS[matched.aspect]
  return matched.polarity === undefined
    ? `Matched: ${topic}`
    : `Matched: ${topic}, ${POLARITY_WORD[matched.polarity].toLowerCase()}`
}

/**
 * What the review is about, in the dashboard's vocabulary. The sentiment chip
 * the old analysis panel led with is gone: a chip per mentioned topic already
 * says which way each one points, and one summary word over the top of them
 * only disagreed with the detail underneath it.
 *
 * The "Needs attention" pill is gone too (owner P-5, 2026-10-28). It showed the
 * AI's urgent-or-high, so it contradicted a manager's Low a few centimetres
 * away, and the same words are the open-feedback status in the toolbar. The
 * toolbar's Priority control now says the level; when a person's level and the
 * current suggestion disagree, one muted line here says what the review's
 * signals suggest (copy C-10).
 */
export function TopicChips({
  analysis,
  managerPriority = null,
  matched = null,
}: Readonly<{
  analysis: InboxReviewAnalysis | null
  /** The level a person set on the item, if any (ADR 0071). */
  managerPriority?: InboxPriority | null
  /** The topic the Inbox was opened on (a Guest voice link), to mark where it is here. */
  matched?: MatchedTopic | null
}>): ReactNode {
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

  const hint = prioritySuggestionHint(managerPriority, prioritySuggestion(analysis))
  const hintLine = hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null

  // A `ready` analysis may name no aspect at all. An empty `<ul>` is announced
  // as "Review topics, list, 0 items" and still takes its share of the guest
  // article's gap, so render no list when nothing would go inside it.
  if (analysis.aspects.length === 0) return hintLine

  const chips = (
    <ul aria-label="Review topics" className="flex flex-wrap items-center gap-2">
      {analysis.aspects.map((aspect) => (
        <li key={`${aspect.aspect}:${aspect.polarity}`}>
          <AspectChip aspect={aspect} matched={isMatched(aspect, matched)} />
        </li>
      ))}
    </ul>
  )
  // Said only when this review holds the topic: a review the analysis has since
  // moved off it has nothing to point at.
  const matchedNote =
    matched !== null && analysis.aspects.some((aspect) => isMatched(aspect, matched)) ? (
      <p className="text-xs text-muted-foreground">{matchedLine(matched)}</p>
    ) : null
  if (!hintLine && !matchedNote) return chips
  // The lines belong to the chips, so they sit closer to them than the guest
  // article's own gap.
  return (
    <div className="flex flex-col gap-2">
      {chips}
      {matchedNote}
      {hintLine}
    </div>
  )
}
