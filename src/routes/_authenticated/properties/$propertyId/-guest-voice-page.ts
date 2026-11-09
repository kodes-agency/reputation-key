// What Guest voice draws for a Property: the page where its reviews have an analysis, and
// otherwise the reason there is none. The server decides (`getGuestVoiceV2Fn`); the route
// only reads what it answered. An answer that is not a page is drawn as "AI is off" or
// "being prepared".
import type {
  GuestVoiceV2Read,
  GuestVoiceV2Response,
} from '#/contexts/ai/application/public-api'
import type { GuestVoiceGoalFacts } from '#/contexts/ai/guest-voice/ui/guest-voice-rating-goal-words'
import type { RatingGoalCardView } from '#/contexts/reporting/rating-goals/contracts'
import type { GuestVoiceRange } from '#/shared/dashboard-range'

/** What the server function answers: the page, or why there is none to draw. */
export type GuestVoiceV2Answer =
  Exclude<GuestVoiceV2Response, Readonly<{ status: 'drafted' }>> | GuestVoiceV2Read

/** The Guest voice page in an answer, or null when the answer is a reason, not a page. */
export function guestVoiceV2PageOf(
  answer: GuestVoiceV2Answer | undefined,
): GuestVoiceV2Read | null {
  if (answer === undefined) return null
  return answer.status === 'ready' || answer.status === 'not_enough_reviews'
    ? answer
    : null
}

/**
 * What the page says in place of itself, for an answer that is not a page: AI analysis is
 * off, or it is still being prepared (nothing analysed yet counts as being
 * prepared: the replay has not reached this Property, or it has no review with text).
 * Null for an answer that is a page, and for no answer yet.
 */
export function guestVoiceReasonOf(
  answer: GuestVoiceV2Answer | undefined,
): 'disabled' | 'preparing' | null {
  if (answer === undefined || guestVoiceV2PageOf(answer) !== null) return null
  return answer.status === 'disabled' ? 'disabled' : 'preparing'
}

/**
 * The range Guest voice draws for the address's. It has no "All time": a bookmark that
 * still says so is read as the automatic window, as the server reads it, and the page
 * shows (and the address then says) that window rather than a control with nothing chosen.
 */
export function guestVoiceV2RangeOf(range: GuestVoiceRange): GuestVoiceRange {
  return range === 'all' ? 'auto' : range
}

/**
 * Where the Property's active Google rating goal stands, for the header meta line.
 * Only an active goal is named: one reached, ended or not yet read is not a goal the page
 * has anything to say about, and a card that could not be read (no goal, no permission,
 * the capability off) is `undefined` and says nothing.
 */
export function guestVoiceGoalOf(
  card: RatingGoalCardView | null | undefined,
): GuestVoiceGoalFacts | null {
  if (card === null || card === undefined || card.state !== 'active') return null
  return {
    mode: card.mode,
    target: card.target,
    shows: card.google?.shows ?? null,
    status: card.status,
  }
}
