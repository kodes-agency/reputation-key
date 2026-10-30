import type {
  GuestVoiceV2Ready,
  ReviewTopicV3,
} from '#/contexts/ai/application/public-api'
import { REVIEW_TOPIC_LABELS_V3 } from '#/shared/review-topic-taxonomy'
import { reviewsPhrase, windowDates } from './guest-voice-words'

/** Only fixed product labels and unique topic counts can enter the clipboard. */
export function guestVoiceTeamSummary(read: GuestVoiceV2Ready): string {
  const line = (
    items: readonly Readonly<{ topic: ReviewTopicV3 }>[],
    sense: 'praiseReviews' | 'complaintReviews',
  ) =>
    [...new Set(items.slice(0, 3).map((item) => item.topic))]
      .map((topic) => {
        const count = read.everyTopic.find((row) => row.topic === topic)?.[sense] ?? 0
        return `${REVIEW_TOPIC_LABELS_V3[topic]} — ${reviewsPhrase(count)}`
      })
      .join('; ')
  const praise = line(read.guestsLove, 'praiseReviews')
  const fix = line(read.fixFirst, 'complaintReviews')
  const { groupCount, reviewCount } = read.seriousConcerns
  return [
    `Guest voice · ${windowDates(read.startLocalDate, read.endLocalDate)}`,
    ...(praise ? [`What guests praised: ${praise}.`] : []),
    ...(fix ? [`What to work on: ${fix}.`] : []),
    `Serious concerns reported: ${groupCount} ${groupCount === 1 ? 'group' : 'groups'} in ${reviewsPhrase(reviewCount)}.`,
    ...(read.provisional ? ['Figures reflect the reviews analysed so far.'] : []),
  ].join('\n')
}
