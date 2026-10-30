import { TouchInlineLink as InlineLink } from '#/components/ui/inline-touch-link'
import type { LiveEvidence } from '#/contexts/ai/application/public-api'
import { cn } from '#/lib/utils'
import { quoteSegments } from './guest-voice-quote-segments'
import { reviewDay } from './guest-voice-words'
import type { ChangeSense } from './guest-voice-words'

// The underline is the highlight; its colour only says which way the guest was
// speaking, and the section the quote sits in says it in words.
const UNDERLINE: Readonly<Record<ChangeSense, string>> = {
  complaint: 'decoration-negative',
  praise: 'decoration-positive',
}

/**
 * One guest's words, read live from the review: the sentences the analysis cites are
 * underlined, the rest is context. Nothing here is stored; the text arrives with the
 * page and goes with it. The way into the review is under it.
 */
export function GuestVoiceQuote({
  evidence,
  sense,
  propertyId,
}: Readonly<{ evidence: LiveEvidence; sense: ChangeSense; propertyId: string }>) {
  const segments = quoteSegments(evidence.text, evidence.sentenceRanges)
  const day = reviewDay(evidence.reviewedAt)
  return (
    <figure data-slot="guest-voice-quote" className="flex min-w-0 flex-col gap-1.5">
      <blockquote className="border-l pl-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
        “
        {segments.map((segment, index) =>
          segment.highlighted ? (
            <mark
              key={index}
              className={cn(
                'bg-transparent text-inherit underline decoration-2 underline-offset-4',
                UNDERLINE[sense],
              )}
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
        ”
      </blockquote>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
        <span>
          <span aria-hidden="true">{evidence.rating}★</span>
          <span className="sr-only">{evidence.rating} stars</span>
        </span>
        {day === null ? null : <span>{day}</span>}
        <InlineLink to="/inbox" search={{ propertyId, itemId: evidence.inboxItemId }}>
          Open in the Inbox
        </InlineLink>
      </figcaption>
    </figure>
  )
}
