import type {
  GuestVoiceTopicDrawer,
  GuestVoiceCauseRow,
} from '#/contexts/ai/application/public-api'
import { SectionTitle } from '#/components/ui/section-title'
import { Button } from '#/components/ui/button'
import { useGuestVoice } from './guest-voice-context'
import { TOPIC_DEFINITIONS } from './guest-voice-topic-definitions'
import { topicStatusWords } from './guest-voice-check-in-words'
import { GuestVoiceLinkedConcerns } from './guest-voice-linked-concerns'

export function GuestVoiceTopicDetails({
  drawer,
}: Readonly<{ drawer: GuestVoiceTopicDrawer }>) {
  const { onOpenDetail } = useGuestVoice()
  const { assessment: a } = drawer
  const causes = (
    label: string,
    rows: readonly GuestVoiceCauseRow[],
    sense: 'complaint' | 'praise',
  ) => (
    <section className="flex flex-col gap-2">
      <SectionTitle level={3}>{label}</SectionTitle>
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">None mentioned in this period.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row, index) => (
            <li key={`${row.issueId}:${index}`}>
              {row.issueId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="inline"
                  touch
                  className="w-full justify-between py-2 text-left whitespace-normal"
                  data-detail-focus={`${sense}:${row.issueId}`}
                  onClick={() =>
                    onOpenDetail?.({ kind: 'issue', issueId: row.issueId ?? '', sense })
                  }
                >
                  {row.title} · {row.reviewCount} reviews
                </Button>
              ) : (
                <p className="py-2 text-sm">
                  {row.title} · {row.reviewCount} reviews
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
  const dislikesFirst =
    a.status === 'needs_attention' || a.status === 'mixed' || a.status === 'unjudged'
  const liked = causes('What guests liked', drawer.likedCauses, 'praise')
  const disliked = causes('What guests disliked', drawer.dislikedCauses, 'complaint')
  return (
    <>
      <p className="text-sm">
        {a.mentionedReviewCount} reviews mention this part: {a.happyReviewCount} happy,{' '}
        {a.mixedReviewCount} mixed, {a.unhappyReviewCount} unhappy and{' '}
        {a.neutralOnlyReviewCount} neutral.
      </p>
      <p className="text-sm">
        {topicStatusWords[a.status]}
        {a.status === 'unjudged'
          ? ' · at least six reviews are needed to judge this part.'
          : ' · based on praise without a complaint, out of all reviews mentioning this part.'}
      </p>
      <p className="text-sm text-muted-foreground">
        {TOPIC_DEFINITIONS[drawer.topic]} Causes can overlap; their counts do not add up
        to the topic total.
      </p>
      {dislikesFirst ? (
        <>
          {disliked}
          {liked}
        </>
      ) : (
        <>
          {liked}
          {disliked}
        </>
      )}
      <GuestVoiceLinkedConcerns items={drawer.linkedConcerns} />
    </>
  )
}
