import { ChevronRight, CircleCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { InlineLink } from '#/components/ui/inline-link'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { GuestVoiceSeriousConcerns } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceSection } from './guest-voice-section'
import { lastReportedText, periodWords, urgentAnswer } from './guest-voice-check-in-words'
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
      <p className="flex items-start gap-2 py-1 text-sm text-muted-foreground">
        <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-positive" />
        {concerns.coverage === 'complete'
          ? `No serious concerns reported in ${periodWords(window)}`
          : 'No serious concerns found in the reviews analysed so far. Some reviews are still being analysed.'}
      </p>
    )
  return (
    <GuestVoiceSection
      title="Anything urgent?"
      answer={urgentAnswer(concerns.groupCount)}
      tone="negative"
    >
      <ul className="divide-y">
        {concerns.items.map((item) => (
          <li key={item.key}>
            <Button
              type="button"
              variant="ghost"
              size="inline"
              touch
              className="w-full justify-between gap-3 py-3 text-left whitespace-normal"
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
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold">{item.title}</span>
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
          {concerns.remainingGroupCount} more serious concerns ·{' '}
          {concerns.remainingReviewCount} additional reviews.
          {can('inbox.read') ? (
            <>
              {' '}
              <InlineLink
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
