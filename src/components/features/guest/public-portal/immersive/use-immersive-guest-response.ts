import { useState } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { useAction } from '#/components/hooks/use-action'
import {
  buildGuestResponseHandlers,
  type GuestResponseActions,
} from './guest-response-actions'
import type {
  ImmersiveResponseFailure,
  ImmersiveResponseNotice,
  ImmersiveResponseViewProps,
} from './immersive-response-types'

/** The part of the response view's props the session decides; the page adds the pack and the name. */
export type ImmersiveSessionProps = Omit<
  ImmersiveResponseViewProps,
  'pack' | 'displayName' | 'yourResponse'
> &
  Readonly<{
    /** The session's current nonce: a tile's selector is bound to it. */
    csrfNonce: string
    /** The handlers "Your response" binds; the page adds the clock. */
    yourResponse: Omit<NonNullable<ImmersiveResponseViewProps['yourResponse']>, 'clock'>
  }>

/**
 * Binds the guest's actions to a session and returns the response view's props:
 * the response, the nonce a start-over rotates, the message to show and the
 * handlers. The state lives here and the calls in `buildGuestResponseHandlers`,
 * so the view never sees an action.
 */
export function useImmersiveGuestResponse(
  input: Readonly<{
    token: string
    csrfNonce: string
    initialResponse: GuestResponseView | null
    googleReviewAvailable: boolean
    availability: ImmersiveResponseViewProps['availability']
    actions: GuestResponseActions
  }>,
): ImmersiveSessionProps {
  const [response, setResponse] = useState(input.initialResponse)
  const [csrfNonce, setCsrfNonce] = useState(input.csrfNonce)
  const [failure, setFailure] = useState<ImmersiveResponseFailure | null>(null)
  const [notice, setNotice] = useState<ImmersiveResponseNotice | null>(null)
  // The route hands in a composed callback for start-over (it also refreshes
  // the route's cache), so it is wrapped here to report whether it is pending.
  const startNewResponse = useAction(input.actions.startNewResponse)
  const actions = { ...input.actions, startNewResponse }
  const pending = Object.values(actions).some((action) => action.isPending === true)

  const handlers = buildGuestResponseHandlers({
    actions,
    token: input.token,
    csrfNonce,
    googleReviewAvailable: input.googleReviewAvailable,
    setResponse,
    setCsrfNonce,
    setFailure,
    setNotice,
    navigate: (url) => window.location.assign(url),
  })

  return {
    csrfNonce,
    availability: input.availability,
    response,
    googleReviewAvailable: input.googleReviewAvailable,
    pending,
    failure,
    notice,
    yourResponse: {
      onChangeRating: handlers.onChangeRating,
      onRemoveNote: handlers.onRemoveNote,
      onRemoveResponse: handlers.onRemoveResponse,
      onStartOver: handlers.onStartOver,
    },
    onSubmitRating: handlers.onSubmitRating,
    onSubmitNote: handlers.onSubmitNote,
    onGoogleReview: handlers.onGoogleReview,
  }
}
