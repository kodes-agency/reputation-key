import { REVIEW_STRENGTH_RANK_V3 } from '#/shared/review-analysis-v3'
import type { GuestVoiceMention, GuestVoiceReview } from './guest-voice-v2-facts'

/** Safety first, then the strongest, then the first the guest named. */
function morePrimary(
  best: GuestVoiceMention | null,
  mention: GuestVoiceMention,
): GuestVoiceMention {
  if (best === null) return mention
  const bestSafety = best.topic === 'safety'
  const safety = mention.topic === 'safety'
  if (bestSafety !== safety) return safety ? mention : best
  const bestStrength = REVIEW_STRENGTH_RANK_V3[best.strength]
  const strength = REVIEW_STRENGTH_RANK_V3[mention.strength]
  if (bestStrength !== strength) return strength > bestStrength ? mention : best
  return mention.mentionOrdinal < best.mentionOrdinal ? mention : best
}

/**
 * The problem an Urgent review reports: its safety complaint when it has one (the guide
 * asks for one beside every Urgent safety reason), else its strongest. Null when the
 * review names no problem that belongs to an issue.
 */
export function primaryComplaint(review: GuestVoiceReview): GuestVoiceMention | null {
  let best: GuestVoiceMention | null = null
  for (const mention of review.mentions) {
    if (mention.polarity !== 'negative' || mention.issueGroupId === null) continue
    best = morePrimary(best, mention)
  }
  return best
}
