/**
 * Pure label and visibility rules for the guest response form. Kept out of
 * `guest-response-fields.tsx` so the rules are unit-testable — tests are not
 * permitted under `src/components/**`, JSX is not required to exercise them,
 * and the field components stay a flat sequence of markup.
 */

/** The rating values a guest may pick, hoisted so rendering allocates nothing. */
export const GUEST_RATING_VALUES = [1, 2, 3, 4, 5] as const

/** Accessible name for one rating radio, e.g. `1 star` / `4 stars`. */
export function guestRatingOptionLabel(value: number): string {
  return `${value} ${value === 1 ? 'star' : 'stars'}`
}

/** Submit button copy: saving beats correcting beats the first submission. */
export function guestSubmitLabel(pending: boolean, isCorrecting: boolean): string {
  if (pending) return 'Saving…'
  return isCorrecting ? 'Save one correction' : 'Submit response'
}

/**
 * Which media surface a guest sees. A correction may not touch media at all, so
 * it renders nothing rather than the degradation copy.
 */
export type GuestMediaSection = 'upload' | 'unavailable' | 'hidden'

export function guestMediaSection(
  isCorrecting: boolean,
  mediaEnabled: boolean,
): GuestMediaSection {
  if (isCorrecting) return 'hidden'
  return mediaEnabled ? 'upload' : 'unavailable'
}
