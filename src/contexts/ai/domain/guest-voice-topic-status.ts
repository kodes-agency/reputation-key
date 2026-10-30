export type GuestVoiceTopicStatus =
  'needs_attention' | 'mixed' | 'doing_well' | 'great' | 'unjudged'

/** All unique mentioning reviews are the denominator, including mixed and neutral. */
export function guestVoiceTopicStatus(
  input: Readonly<{
    mentionedReviews: number
    happyReviews: number
  }>,
): Readonly<{ status: GuestVoiceTopicStatus; happyShare: number | null }> {
  if (input.mentionedReviews < 6) return { status: 'unjudged', happyShare: null }
  const happyShare = input.happyReviews / input.mentionedReviews
  return {
    happyShare,
    status:
      happyShare < 0.45
        ? 'needs_attention'
        : happyShare < 0.65
          ? 'mixed'
          : happyShare < 0.8
            ? 'doing_well'
            : 'great',
  }
}
