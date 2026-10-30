import type { GuestVoiceV2Ready } from '#/contexts/ai/application/public-api'
import { InlineLink } from '#/components/ui/inline-link'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { GuestVoiceIssueTitle } from './guest-voice-issue-title'
import { GuestVoiceNothingHere, GuestVoiceSection } from './guest-voice-section'
import { GuestVoiceDisclosure } from './guest-voice-disclosure'
import { GuestVoiceTeamSummaryButton } from './guest-voice-team-summary-button'
import { GuestVoiceOverflow } from './guest-voice-overflow'
import { praiseAnswer, morePraiseLabel } from './guest-voice-check-in-words'
import { useGuestVoice } from './guest-voice-context'

export function GuestVoiceGuestsLove({ read }: Readonly<{ read: GuestVoiceV2Ready }>) {
  const { can } = usePermissions()
  const { propertyId, startLocalDate, endLocalDate } = useGuestVoice()
  const rows = (items: GuestVoiceV2Ready['guestsLove']) => (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.issueId}>
          <GuestVoiceIssueTitle
            issueId={item.issueId}
            title={item.title}
            topic={item.topic}
            sense="praise"
          >
            <span className="font-normal text-muted-foreground">
              {item.statistics.reviewCount} guests said so
            </span>
            {!read.provisional &&
            item.statistics.change === 'rising' &&
            item.statistics.evidenceLevel === 'likely' ? (
              <span className="font-normal text-positive">
                More praise lately: mentioned more often than in the 12 months before this
                period.
              </span>
            ) : null}
          </GuestVoiceIssueTitle>
        </li>
      ))}
    </ul>
  )
  return (
    <GuestVoiceSection
      title="What are we doing well?"
      answer={praiseAnswer(read.guestsLove)}
      icon="praise"
      compact={!read.guestsLove.length}
      hint={
        read.guestsLove.length
          ? 'Keep these going, and thank guests for them in your replies.'
          : undefined
      }
      tone="positive"
      footer={
        read.guestsLove.length ? <GuestVoiceTeamSummaryButton read={read} /> : undefined
      }
    >
      {read.guestsLove.length ? (
        rows(read.guestsLove.slice(0, 3))
      ) : (
        <GuestVoiceNothingHere>
          Nothing is praised in enough reviews to report yet.
        </GuestVoiceNothingHere>
      )}
      {read.guestsLove.length > 3 ? (
        <GuestVoiceDisclosure label={morePraiseLabel(read.guestsLove.length - 3)}>
          {rows(read.guestsLove.slice(3))}
        </GuestVoiceDisclosure>
      ) : null}
      <GuestVoiceOverflow
        count={read.remainingCounts.guestsLove}
        label="things guests love"
      />
      {read.staffPraise ? (
        <p className="border-t py-3 text-sm text-muted-foreground">
          {read.staffPraise.reviewCount}{' '}
          {read.staffPraise.reviewCount === 1 ? 'guest' : 'guests'}{' '}
          {read.staffPraise.reviewCount === 1 ? 'praises' : 'praise'} a team member by
          name
          {can('inbox.read') ? (
            <>
              {' '}
              ·{' '}
              <InlineLink
                to="/inbox"
                search={{ propertyId, since: startLocalDate, until: endLocalDate }}
              >
                Open this period’s reviews
              </InlineLink>
            </>
          ) : null}
        </p>
      ) : null}
    </GuestVoiceSection>
  )
}
