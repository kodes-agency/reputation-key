/**
 * Pure label and visibility rules for the guest response form. Kept out of
 * `guest-response-fields.tsx` so the rules are unit-testable — tests are not
 * permitted under `src/components/**`, JSX is not required to exercise them,
 * and the field components stay a flat sequence of markup.
 *
 * The same reason keeps the form's other decisions here: which draft it opens
 * with, which act it is serving, why a draft may not be submitted yet, and what
 * each outcome tells the guest. The components below `guest-response-form.tsx`
 * then hold state and effects only, and none of them branches on copy.
 */

import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { mediaRejectionMessage } from './guest-media'

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

/**
 * The guest's in-progress edit. Held separately from the persisted
 * `GuestResponseView` because the two disagree for as long as the guest is
 * typing, and every rule below decides on the edit rather than on what was last
 * written.
 */
export type GuestResponseDraft = Readonly<{
  rating: number | null
  text: string
  responseConsent: boolean
  textConsent: boolean
  mediaConsent: boolean
}>

/**
 * The draft a form opens with. A withdrawn or absent response contributes
 * nothing, and a persisted `null` rating or text means "not given" rather than
 * "empty", so both collapse to the same blank draft.
 */
export function guestResponseDraft(
  response: GuestResponseView | null,
): GuestResponseDraft {
  return {
    rating: response?.rating ?? null,
    text: response?.text ?? '',
    responseConsent: response?.responseConsent ?? false,
    textConsent: response?.textConsent ?? false,
    mediaConsent: response?.mediaConsent ?? false,
  }
}

/**
 * Which of the three acts the form is currently serving. Both flags read the one
 * status, so they are derived together — a response cannot be correctable and
 * past correcting at once, and computing them apart invites that contradiction.
 */
export type GuestResponsePhase = Readonly<{
  /** A submitted response, still inside its single correction window. */
  isCorrecting: boolean
  /** Corrected or withdrawn: nothing further may be edited or withdrawn. */
  isTerminal: boolean
}>

export function guestResponsePhase(
  response: GuestResponseView | null,
): GuestResponsePhase {
  return {
    isCorrecting: response?.status === 'submitted',
    isTerminal: response?.status === 'corrected' || response?.status === 'deleted',
  }
}

/**
 * Why this draft may not be submitted yet, as the sentence the guest is shown —
 * or `null` when it may. Order is the order a guest fills the form in, so the
 * first thing they still have to decide is the thing they are asked about.
 *
 * Consent is demanded per optional part and only once that part has content:
 * an untouched field must never block the submit, and a filled one must never
 * be sent on an unanswered consent.
 */
export function guestDraftBlockReason(
  draft: GuestResponseDraft,
  hasMedia: boolean,
): string | null {
  const text = draft.text.trim()
  if (draft.rating == null && text.length === 0)
    return 'Choose a rating or enter feedback before submitting.'
  if (draft.rating != null && !draft.responseConsent)
    return 'Choose whether to share the optional rating.'
  if (text.length > 0 && !draft.textConsent)
    return 'Choose whether to share the optional written feedback.'
  if (hasMedia && !draft.mediaConsent)
    return 'Choose whether to share the optional image.'
  return null
}

/** What a completed save tells the guest they may still do. */
export function guestSaveSuccessMessage(isCorrecting: boolean): string {
  if (isCorrecting) return 'Your response was corrected. You can still withdraw it.'
  return 'Your optional response was submitted. You may correct it once for one hour.'
}

/**
 * A failed save, as one sentence. A thrown `Error` is already guest-facing copy
 * from the server boundary; anything else has no message worth showing.
 */
export function guestSaveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The response could not be saved.'
}

/** A failed withdrawal. The response is untouched, so the guest may retry. */
export const guestWithdrawErrorMessage =
  'The response could not be withdrawn. Please try again.'

/** What a completed withdrawal confirms was removed, not merely hidden. */
export const guestWithdrawSuccessMessage =
  'Your response was withdrawn and its content was removed.'

/**
 * The message after a file-input change: the rejection copy while a rejected file
 * is selected, and otherwise the current message with a stale rejection cleared.
 * An unrelated message survives — a rejected image must not swallow a save error.
 */
export function guestMediaSelectionMessage(rejected: boolean, current: string): string {
  if (rejected) return mediaRejectionMessage
  return current === mediaRejectionMessage ? '' : current
}
