import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import type { NoteDraft, NoteSubmission } from './immersive-note-card'
import type { RatingSubmission } from './immersive-rating-card'
import type { ResponseClock } from './immersive-response-rows'
import type {
  ResponseSectionFailure,
  ResponseSectionNotice,
} from './immersive-response-section'

/** Which call the guest last tried failed. At most one message shows at a time, in its own card. */
export type ImmersiveResponseFailure =
  'rating' | 'google' | 'note' | ResponseSectionFailure

/**
 * What just worked, read out where the guest is looking: in the section, or
 * above a fresh rating card. Starting over after the guest removed their whole
 * response is its own notice: nothing earlier "remains saved".
 */
export type ImmersiveResponseNotice =
  ResponseSectionNotice | 'started-over' | 'started-over-after-removal'

/**
 * What "Your response" (board G07) needs from the page. The page binds the
 * actions; this view only shows them. Without it the page offers no way to
 * change or remove a response: no section, and no Change in the receipt.
 */
export type YourResponseActions = Readonly<{
  /** The portal's zone and the `now` that travels with the page data. */
  clock: ResponseClock
  /** Starts the section open, for previews and stories. A live page starts it closed. */
  initialOpen?: boolean
  onChangeRating: (value: RatingSubmission) => Promise<void>
  onRemoveNote: () => void
  onRemoveResponse: () => void
  onStartOver: () => void
}>

export type ImmersiveResponseViewProps = Readonly<{
  /** The one v2 pack of the page's language. */
  pack: GuestPortalCopyV2
  /** The property's display name: "Shared privately with Avela Resort." */
  displayName: string
  availability?: 'available' | 'loading' | 'unavailable'
  /** The guest's response, or null before they rate. */
  response: GuestResponseView | null
  googleReviewAvailable: boolean
  /** A call is on its way: the choices wait. */
  pending?: boolean
  failure?: ImmersiveResponseFailure | null
  /** The note's starting state, for previews and stories. */
  noteDraft?: NoteDraft
  notice?: ImmersiveResponseNotice | null
  yourResponse?: YourResponseActions
  onSubmitRating: (value: RatingSubmission) => Promise<void>
  onSubmitNote: (value: NoteSubmission) => Promise<boolean>
  onGoogleReview: () => void
}>

/** The failure the section reports, or null when the failed call was another card's. */
export function sectionFailureOf(
  failure: ImmersiveResponseFailure | null,
): ResponseSectionFailure | null {
  return failure === 'remove-note' || failure === 'remove-all' || failure === 'start-over'
    ? failure
    : null
}

/** The notice the section reads out, or null when it belongs above a fresh rating card. */
export function sectionNoticeOf(
  notice: ImmersiveResponseNotice | null,
): ResponseSectionNotice | null {
  return notice === 'rating-updated' || notice === 'note-removed' ? notice : null
}
