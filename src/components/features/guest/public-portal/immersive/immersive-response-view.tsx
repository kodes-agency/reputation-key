import { useEffect, useRef } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
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

/** Where the guest is in the response: the part of the page that is on screen. */
type Stage = 'arrival' | 'rated' | 'removed'

function stageOf(response: GuestResponseView | null): Stage {
  if (response === null) return 'arrival'
  return response.status === 'deleted' || response.rating === null ? 'removed' : 'rated'
}

/**
 * An action that replaces the part of the page the guest was in takes their
 * focus with it, and a live region that arrives already holding its words is
 * often not read out. So focus follows the guest to what replaced it, and the
 * screen reader reads it on arrival: a rating sent goes to the receipt heading,
 * "Start over" to the page's "ready for the next guest" line, and a removed
 * response to the heading of its notice. A page that loads in any of these
 * keeps focus where it is.
 */
function useFocusOnStageChange(stage: Stage) {
  const receiptHeading = useRef<HTMLHeadingElement>(null)
  const startedOver = useRef<HTMLParagraphElement>(null)
  const removedHeading = useRef<HTMLHeadingElement>(null)
  const previous = useRef(stage)

  useEffect(() => {
    if (previous.current !== stage) {
      const target = {
        rated: receiptHeading,
        arrival: startedOver,
        removed: removedHeading,
      }[stage]
      target.current?.focus()
    }
    previous.current = stage
  }, [stage])

  return { receiptHeading, startedOver, removedHeading }
}

function ResponseBody(props: ImmersiveResponseViewProps) {
  const { pack, response, availability = 'available' } = props
  const stage = stageOf(response)
  const { receiptHeading, startedOver, removedHeading } = useFocusOnStageChange(stage)

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
        <h2 ref={removedHeading} tabIndex={-1} className="ih-display ih-card-title">
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
          <p role="status" tabIndex={-1} ref={startedOver} className="ih-yr__ready">
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
