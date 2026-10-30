import type { IssueDrawer } from '#/contexts/ai/application/public-api'
import { Button } from '#/components/ui/button'
import { GuestVoiceCauses } from './guest-voice-causes'
import { useGuestVoice } from './guest-voice-context'
import { GuestVoiceEvidence } from './guest-voice-evidence'
import { GuestVoiceIssueActions } from './guest-voice-issue-actions'
import { GuestVoiceMonthBars } from './guest-voice-month-bars'
import { GuestVoiceRatingComparison } from './guest-voice-rating-comparison'
import { GuestVoiceLinkedConcerns } from './guest-voice-linked-concerns'
import { TOPIC_DEFINITIONS } from './guest-voice-topic-definitions'
import { topicLabel, reviewDay } from './guest-voice-words'

export function GuestVoiceIssueDetails({ drawer }: Readonly<{ drawer: IssueDrawer }>) {
  const { onOpenDetail } = useGuestVoice()
  return (
    <>
      <p className="text-sm">
        {drawer.statistics.reviewCount}{' '}
        {drawer.statistics.reviewCount === 1 ? 'guest' : 'guests'} brought it up · last
        mentioned {reviewDay(drawer.lastMentionedLocalDate)}
      </p>
      <GuestVoiceRatingComparison comparison={drawer.commentComparison} />
      <p className="text-sm leading-relaxed">
        {TOPIC_DEFINITIONS[drawer.topic]} {drawer.definition}
      </p>
      <GuestVoiceCauses causes={drawer.causes} label="What guests mentioned" />
      {drawer.hidden ? (
        <p className="text-sm text-muted-foreground">
          Hidden from ranked lists. Its reviews still count in topics and serious
          concerns.
        </p>
      ) : null}
      <GuestVoiceLinkedConcerns items={drawer.linkedConcerns} />
      <GuestVoiceEvidence drawer={drawer} />
      <div className="hidden md:block">
        <GuestVoiceIssueActions
          scope={drawer.matchingReviews}
          reviewCount={drawer.statistics.reviewCount}
        />
      </div>
      <GuestVoiceMonthBars series={drawer.twelveMonthSeries} />
      {drawer.historyCoverage === 'window_only' ? (
        <p className="text-xs text-muted-foreground">
          Only this period’s history is available. Earlier months are unavailable, not
          zero.
        </p>
      ) : null}
      <p className="text-sm">
        Part of{' '}
        <Button
          type="button"
          variant="link"
          size="inline"
          touch
          data-detail-focus={`topic:${drawer.topic}`}
          onClick={() => onOpenDetail?.({ kind: 'topic', topic: drawer.topic })}
        >
          {topicLabel(drawer.topic)}
        </Button>
      </p>
    </>
  )
}
