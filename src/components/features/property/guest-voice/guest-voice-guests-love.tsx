import { Heart } from 'lucide-react'
import { inlineLinkClass } from '#/components/ui/inline-link'
import type {
  GuestsLoveItem,
  StaffPraiseLine,
} from '#/contexts/ai/application/public-api'
import { ChangeBadge, Figures } from './guest-voice-figures'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceIssueTitle } from './guest-voice-issue-title'
import { GuestVoiceQuote } from './guest-voice-quote'
import { GuestVoiceNothingHere, GuestVoiceSection } from './guest-voice-section'
import { changePill, inReviewsText, reviewsPhrase } from './guest-voice-words'

function GuestsLoveCard({ item }: Readonly<{ item: GuestsLoveItem }>) {
  const { propertyId } = useGuestVoice()
  const { statistics } = item
  // Praise that rises or falls wears the same pill a problem does; steady is a word.
  const pill = changePill(statistics.change, statistics.evidenceLevel, 'praise')
  return (
    <li>
      <article className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4">
        <GuestVoiceIssueTitle
          issueId={item.issueId}
          title={item.title}
          topic={item.topic}
        />
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
          <Heart aria-hidden="true" className="size-3.5 shrink-0 text-positive" />
          <span>
            <Figures>{inReviewsText(statistics)}</Figures>
            {pill?.direction === 'flat' ? ' · steady' : null}
          </span>
          {pill === null || pill.direction === 'flat' ? null : (
            <ChangeBadge pill={pill} />
          )}
        </p>
        {item.quote == null ? null : (
          <GuestVoiceQuote evidence={item.quote} sense="praise" propertyId={propertyId} />
        )}
      </article>
    </li>
  )
}

/**
 * One neutral line about staff praise: how many reviews praise a team member by name,
 * and the way to read them. No name, no count for a person, no ranking, and never the
 * other side of it (decision Q13).
 */
function StaffPraise({ line }: Readonly<{ line: NonNullable<StaffPraiseLine> }>) {
  const verb = line.reviewCount === 1 ? 'praises' : 'praise'
  return (
    <p className="text-sm text-muted-foreground">
      {reviewsPhrase(line.reviewCount)} {verb} a team member by name
      {' · '}
      <a href={line.inboxHref} className={inlineLinkClass({ underline: 'always' })}>
        read them
      </a>
    </p>
  )
}

/** What guests praise most, so it is kept and said back in replies. */
export function GuestVoiceGuestsLove({
  items,
  staffPraise,
}: Readonly<{ items: readonly GuestsLoveItem[]; staffPraise: StaffPraiseLine }>) {
  return (
    <GuestVoiceSection
      title="Guests love"
      hint="Protect these, and say them back in replies"
    >
      {items.length === 0 ? (
        <GuestVoiceNothingHere>
          Nothing is praised in enough reviews to report yet.
        </GuestVoiceNothingHere>
      ) : (
        <ul className="grid gap-3 @3xl:grid-cols-3">
          {items.map((item) => (
            <GuestsLoveCard key={item.issueId} item={item} />
          ))}
        </ul>
      )}
      {staffPraise === null ? null : <StaffPraise line={staffPraise} />}
    </GuestVoiceSection>
  )
}
