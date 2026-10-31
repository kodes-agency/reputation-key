const TOPIC_MIN_MENTIONED_REVIEWS = 6
const TOPIC_MIXED_MIN_HAPPY_SHARE = 0.45
const TOPIC_DOING_WELL_MIN_HAPPY_SHARE = 0.65
const TOPIC_GREAT_MIN_HAPPY_SHARE = 0.8

export type GuestVoiceTopicStatus =
  'needs_attention' | 'mixed' | 'doing_well' | 'great' | 'unjudged'

/** All unique mentioning reviews are the denominator, including mixed and neutral. */
export function guestVoiceTopicStatus(
  input: Readonly<{
    mentionedReviews: number
    happyReviews: number
  }>,
): Readonly<{ status: GuestVoiceTopicStatus; happyShare: number | null }> {
  if (input.mentionedReviews < TOPIC_MIN_MENTIONED_REVIEWS)
    return { status: 'unjudged', happyShare: null }
  const happyShare = input.happyReviews / input.mentionedReviews
  return {
    happyShare,
    status:
      happyShare < TOPIC_MIXED_MIN_HAPPY_SHARE
        ? 'needs_attention'
        : happyShare < TOPIC_DOING_WELL_MIN_HAPPY_SHARE
          ? 'mixed'
          : happyShare < TOPIC_GREAT_MIN_HAPPY_SHARE
            ? 'doing_well'
            : 'great',
  }
}
