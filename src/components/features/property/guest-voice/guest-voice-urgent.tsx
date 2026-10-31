import { ChevronRight } from 'lucide-react'
import { RowButton as Button } from '#/components/ui/button-layouts'
import { TouchInlineLink as InlineLink } from '#/components/ui/inline-touch-link'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { GuestVoiceSeriousConcerns } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceSection } from './guest-voice-section'
import { lastReportedText, periodWords, urgentAnswer } from './guest-voice-check-in-words'
import { reviewsPhrase } from './guest-voice-words'
import { GuestVoiceTopicIcon } from './guest-voice-topic-icon'
import { urgentReviewsSearch } from './guest-voice-links'

export const CONCERN_WORDS = {
  safety: 'Safety risk',
  health: 'Health risk',
  discrimination: 'Discrimination',
  legal_threat: 'Legal threat',
} as const

export function GuestVoiceUrgent({
  concerns,
}: Readonly<{ concerns: GuestVoiceSeriousConcerns }>) {
  const { propertyId, window, startLocalDate, endLocalDate, onOpenDetail } =
    useGuestVoice()
  const { can } = usePermissions()
  if (!concerns.groupCount)
    return (
      <GuestVoiceSection
        title="Anything urgent?"
        icon="quiet"
        tone="positive"
        compact
        answer={
          concerns.coverage === 'complete'
            ? `No serious concerns reported in ${periodWords(window)}`
            : 'No serious concerns found so far'
        }
      >
        {concerns.coverage === 'provisional' ? (
          <p className="py-2 text-sm text-muted-foreground">
            Some reviews are still being analysed.
          </p>
        ) : null}
      </GuestVoiceSection>
    )
  return (
    <GuestVoiceSection
      title="Anything urgent?"
      icon="urgent"
      answer={urgentAnswer(concerns.groupCount)}
      tone="negative"
    >
      <ul className="divide-y">
        {concerns.items.map((item) => (
          <li key={item.key}>
            <Button
              type="button"
              variant="ghost"

              className="gap-3"
              aria-haspopup={onOpenDetail ? 'dialog' : undefined}
              disabled={!onOpenDetail}
              onClick={() =>
                onOpenDetail?.({
                  kind: 'concern',
                  issueId: item.issueId,
                  reason: item.urgentReason,
                })
              }
            >
              {item.topic ? <GuestVoiceTopicIcon topic={item.topic} row /> : null}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span data-issue-title className="text-base font-semibold">
                  {item.title}{' '}
                  <span className="whitespace-nowrap text-sm text-negative">Read ›</span>
                </span>
                <span className="font-normal text-muted-foreground">
                  <span className="font-medium text-negative">
                    {CONCERN_WORDS[item.urgentReason]}
                  </span>{' '}
                  · {item.reviewCount} {item.reviewCount === 1 ? 'guest' : 'guests'} ·{' '}
                  {lastReportedText(item.lastReportedLocalDate)}
                </span>
              </span>
              <ChevronRight aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {concerns.remainingGroupCount ? (
        <p className="py-2 text-sm text-muted-foreground">
          {concerns.remainingGroupCount} more serious{' '}
          {concerns.remainingGroupCount === 1 ? 'concern' : 'concerns'} ·{' '}
          {reviewsPhrase(concerns.remainingReviewCount)} beyond this list.
          {can('inbox.read') ? (
            <>
              {' '}
              <InlineLink
                underline="always"
                to="/inbox"
                search={{
                  ...urgentReviewsSearch(propertyId),
                  since: startLocalDate,
                  until: endLocalDate,
                }}
              >
                Open these reviews in the Inbox
              </InlineLink>
            </>
          ) : null}
        </p>
      ) : null}
      {concerns.coverage === 'provisional' ? (
        <p className="text-sm text-muted-foreground">
          Some reviews are still being analysed. More concerns may appear.
        </p>
      ) : null}
    </GuestVoiceSection>
  )
}
