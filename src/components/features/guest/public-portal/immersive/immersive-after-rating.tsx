import { type RefObject, useState } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { ImmersiveGoogleCard } from './immersive-google-card'
import { ImmersiveNoteCard } from './immersive-note-card'
import { ImmersiveReceiptStrip } from './immersive-receipt-strip'
import { ImmersiveResponseSection } from './immersive-response-section'
import {
  sectionFailureOf,
  sectionNoticeOf,
  type ImmersiveResponseViewProps,
} from './immersive-response-types'

/**
 * The page once the guest has rated, in this order and at every rating: the
 * receipt strip, the Google card, the private note card when the server offers
 * it, and "Your response".
 *
 * It keeps what the receipt's Change and the section share: whether the section
 * is open, and whether the rating form is open under "Change your rating". The
 * form is open for as long as the response has not been corrected since it
 * opened (`correctedAt` still reads what it read), so an accepted new rating
 * closes it with no effect to say so.
 */
export function ImmersiveAfterRating({
  pack,
  displayName,
  response,
  rating,
  googleReviewAvailable,
  pending = false,
  failure = null,
  noteDraft,
  notice = null,
  yourResponse,
  onSubmitNote,
  onGoogleReview,
  receiptHeading,
}: ImmersiveResponseViewProps & {
  response: GuestResponseView
  rating: number
  receiptHeading: RefObject<HTMLHeadingElement | null>
}) {
  const [open, setOpen] = useState(yourResponse?.initialOpen === true)
  // The `correctedAt` the response had when the form was opened, or null when closed.
  const [changeOpenedAt, setChangeOpenedAt] = useState<Readonly<{
    correctedAt: string | null
  }> | null>(null)
  const changing =
    changeOpenedAt !== null && changeOpenedAt.correctedAt === response.correctedAt
  const openChange = (next: boolean) =>
    setChangeOpenedAt(next ? { correctedAt: response.correctedAt } : null)

  return (
    <div className="ih-response" data-ih-response="rated">
      <ImmersiveReceiptStrip
        pack={pack}
        rating={rating}
        onChange={
          yourResponse && response.correctionAvailable
            ? () => {
                setOpen(true)
                openChange(true)
              }
            : undefined
        }
        headingRef={receiptHeading}
      />
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
      {yourResponse && (
        <ImmersiveResponseSection
          pack={pack}
          response={response}
          clock={yourResponse.clock}
          open={open}
          changing={changing}
          pending={pending}
          failure={sectionFailureOf(failure)}
          ratingFailed={failure === 'rating'}
          notice={sectionNoticeOf(notice)}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) openChange(false)
          }}
          onChangingChange={openChange}
          onChangeRating={yourResponse.onChangeRating}
          onRemoveNote={yourResponse.onRemoveNote}
          onRemoveResponse={yourResponse.onRemoveResponse}
          onStartOver={yourResponse.onStartOver}
        />
      )}
    </div>
  )
}
