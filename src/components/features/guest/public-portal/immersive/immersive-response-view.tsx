import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'
import { GlassSurface } from './glass-surface'
import { ImmersiveGoogleCard } from './immersive-google-card'
import {
  ImmersiveNoteCard,
  type NoteDraft,
  type NoteSubmission,
} from './immersive-note-card'
import { ImmersiveRatingCard, type RatingSubmission } from './immersive-rating-card'
import { ImmersiveReceiptStrip } from './immersive-receipt-strip'
import {
  IMMERSIVE_RESPONSE_CSS,
  IMMERSIVE_RESPONSE_STYLE_HREF,
} from './immersive-response-styles'

/** Which call the guest last tried failed. At most one message shows at a time, in its own card. */
export type ImmersiveResponseFailure = 'rating' | 'google' | 'note'

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
  onSubmitRating: (value: RatingSubmission) => Promise<void>
  onSubmitNote: (value: NoteSubmission) => Promise<boolean>
  onGoogleReview: () => void
  /** Where "Change" in the receipt strip leads. */
  onChangeRating?: () => void
}>

/**
 * The response area of the Immersive Hub, a pure view of its props. Before a
 * rating it is the rating card. After one it is, in this order and at every
 * rating: the receipt strip, the Google card, and the private note card when
 * the server says the guest may write one (`privateFeedbackEligible`). The
 * threshold is the server's; the view never compares a rating with anything.
 *
 * Like `GuestPageView` it binds no action: the container hands in the finished
 * state, which is what lets a preview, a story and the anti-gating test render
 * the markup a guest gets.
 */
export function ImmersiveResponseView(props: ImmersiveResponseViewProps) {
  return (
    <>
      <style href={IMMERSIVE_RESPONSE_STYLE_HREF} precedence="default">
        {IMMERSIVE_RESPONSE_CSS}
      </style>
      <ResponseBody {...props} />
    </>
  )
}

function ResponseBody(props: ImmersiveResponseViewProps) {
  const { pack, response, availability = 'available' } = props
  if (availability === 'loading') {
    return (
      <GlassSurface
        variant="card"
        as="section"
        aria-busy="true"
        className="ih-placeholder"
      >
        <div className="ih-placeholder__line" />
        <div className="ih-placeholder__block" />
      </GlassSurface>
    )
  }
  if (availability === 'unavailable') {
    return (
      <GlassSurface variant="card" as="section" role="status" className="ih-notice">
        <h2 className="ih-display ih-card-title">{pack.copy.unavailableTitle}</h2>
        <p className="ih-card-body">{pack.copy.unavailableBody}</p>
      </GlassSurface>
    )
  }
  if (response?.status === 'deleted' || response?.rating === null) {
    return (
      <GlassSurface variant="card" as="section" role="status" className="ih-notice">
        <h2 className="ih-display ih-card-title">
          {pack.copy.responseRemoveAllDoneTitle}
        </h2>
        <p className="ih-card-body">{pack.copy.responseRemoveAllDoneBody}</p>
      </GlassSurface>
    )
  }
  if (response === null) {
    return (
      <div className="ih-response" data-ih-response="arrival">
        <ImmersiveRatingCard
          pack={pack}
          displayName={props.displayName}
          pending={props.pending === true}
          saveFailed={props.failure === 'rating'}
          onSubmit={props.onSubmitRating}
        />
      </div>
    )
  }
  return <AfterRating {...props} response={response} rating={response.rating} />
}

function AfterRating({
  pack,
  displayName,
  response,
  rating,
  googleReviewAvailable,
  pending = false,
  failure = null,
  noteDraft,
  onSubmitNote,
  onGoogleReview,
  onChangeRating,
}: ImmersiveResponseViewProps & {
  response: GuestResponseView
  rating: number
}) {
  return (
    <div className="ih-response" data-ih-response="rated">
      <ImmersiveReceiptStrip pack={pack} rating={rating} onChange={onChangeRating} />
      <ImmersiveGoogleCard
        pack={pack}
        displayName={displayName}
        available={googleReviewAvailable}
        pending={pending}
        openFailed={failure === 'google'}
        onOpen={onGoogleReview}
      />
      {(response.privateFeedbackEligible || response.hasPrivateFeedback) && (
        <ImmersiveNoteCard
          pack={pack}
          displayName={displayName}
          sent={response.hasPrivateFeedback}
          pending={pending}
          sendFailed={failure === 'note'}
          initial={noteDraft}
          onSubmit={onSubmitNote}
        />
      )}
    </div>
  )
}
