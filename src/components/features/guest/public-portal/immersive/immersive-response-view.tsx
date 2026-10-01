import { useEffect, useRef } from 'react'
import { GlassSurface } from './glass-surface'
import { ImmersiveAfterRating } from './immersive-after-rating'
import { ImmersiveRatingCard } from './immersive-rating-card'
import type { ImmersiveResponseViewProps } from './immersive-response-types'
import {
  IMMERSIVE_RESPONSE_CSS,
  IMMERSIVE_RESPONSE_STYLE_HREF,
} from './immersive-response-styles'

export type {
  ImmersiveResponseFailure,
  ImmersiveResponseNotice,
  ImmersiveResponseViewProps,
  YourResponseActions,
} from './immersive-response-types'

/**
 * The response area of the Immersive Hub, a pure view of its props. Before a
 * rating it is the rating card. After one it is, in this order and at every
 * rating: the receipt strip, the Google card, the private note card when the
 * server says the guest may write one (`privateFeedbackEligible`), and "Your
 * response". The threshold is the server's; the view never compares a rating
 * with anything.
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
  const receiptHeading = useRef<HTMLHeadingElement>(null)
  const unrated = response === null
  const wasUnrated = useRef(unrated)

  // Sending the rating unmounts the card the guest was in, and focus with it.
  // It goes to the receipt heading, which a screen reader reads out, so the
  // guest hears that it worked. A page that loads already rated keeps focus
  // where it is.
  useEffect(() => {
    if (!unrated && wasUnrated.current) receiptHeading.current?.focus()
    wasUnrated.current = unrated
  }, [unrated])

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
        {props.notice === 'started-over' && (
          <p role="status" className="ih-yr__ready">
            {pack.copy.startOverDone}
          </p>
        )}
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
  return (
    <ImmersiveAfterRating
      {...props}
      response={response}
      rating={response.rating}
      receiptHeading={receiptHeading}
    />
  )
}
