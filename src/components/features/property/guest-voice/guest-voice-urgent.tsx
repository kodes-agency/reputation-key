import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { Alert } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import type { FixFirstItem } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { urgentReviewsSearch } from './guest-voice-links'
import { GuestVoiceQuote } from './guest-voice-quote'
import { topicLabel, urgentReasonWords } from './guest-voice-words'

function UrgentItem({ item }: Readonly<{ item: FixFirstItem }>) {
  const { propertyId, onOpenIssue } = useGuestVoice()
  return (
    <li className="flex flex-col gap-2">
      <p className="text-sm text-foreground">
        <strong className="font-semibold">
          Urgent
          {item.urgentReason === null
            ? null
            : ` · ${urgentReasonWords(item.urgentReason)}`}
        </strong>
        {' · '}
        <Button
          type="button"
          variant="link"
          size="inline"
          touch
          aria-haspopup="dialog"
          className="whitespace-normal"
          onClick={() => onOpenIssue(item.issueId)}
        >
          {item.title}
        </Button>
        <span className="text-muted-foreground"> · {topicLabel(item.topic)}</span>
      </p>
      {item.quote == null ? null : (
        <GuestVoiceQuote
          evidence={item.quote}
          sense="complaint"
          propertyId={propertyId}
        />
      )}
    </li>
  )
}

/**
 * A guest has reported a risk to safety or health, discrimination or a legal threat.
 * Rare, and above everything else on the page; the reason is on it, and the Inbox is
 * one press away. The only thing here that is also sent as an alert.
 */
export function GuestVoiceUrgent({
  items,
}: Readonly<{ items: readonly FixFirstItem[] }>) {
  const { propertyId } = useGuestVoice()
  const headingId = useId()
  if (items.length === 0) return null
  return (
    // A region, not an alert: it is on the page for as long as it is true, and the
    // alert itself goes out by email and in the bell when the review arrives.
    <Alert variant="destructive" role="region" aria-labelledby={headingId}>
      <h2 id={headingId} className="col-start-2 text-base font-semibold tracking-tight">
        {items.length === 1 ? 'An urgent review needs you' : 'Urgent reviews need you'}
      </h2>
      <div className="col-start-2 flex flex-col gap-3 pt-1 text-foreground">
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <UrgentItem key={item.issueId} item={item} />
          ))}
        </ul>
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link to="/inbox" search={urgentReviewsSearch(propertyId)}>
            Open urgent reviews in the inbox
          </Link>
        </Button>
      </div>
    </Alert>
  )
}
