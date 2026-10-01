// What a guest's choices on the Immersive Hub do: each handler calls its server
// action with the session, then moves the page's state to what the server said.
//
// Pure logic with no React in it, so what a failure leaves on the screen can be
// tested without a browser. The hook (`use-immersive-guest-response.ts`) owns the
// state and hands the setters in; the view only ever sees the finished props.
//
// Every handler first clears the last failure and notice, so at most one message
// shows (the view's rule), and a call that does not go through leaves the page
// where it was and names the card the failure belongs to.

import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { GuestResponseFormProps } from '../guest-response-form-types'
import { isHttpsUrl } from './linktree-follow'
import type { NoteSubmission } from './immersive-note-card'
import type { RatingSubmission } from './immersive-rating-card'
import type {
  ImmersiveResponseFailure,
  ImmersiveResponseNotice,
} from './immersive-response-types'

/** The seven server actions a live page binds, as the route hands them in. */
export type GuestResponseActions = Pick<
  GuestResponseFormProps,
  | 'submitResponse'
  | 'correctResponse'
  | 'startNewResponse'
  | 'submitPrivateFeedback'
  | 'selectGoogleReview'
  | 'withdrawResponse'
  | 'withdrawPrivateFeedback'
>

/** Where the handlers put what they learn. The hook backs each with state. */
export type GuestResponseSetters = Readonly<{
  setResponse: (response: GuestResponseView | null) => void
  setCsrfNonce: (nonce: string) => void
  setFailure: (failure: ImmersiveResponseFailure | null) => void
  setNotice: (notice: ImmersiveResponseNotice | null) => void
  /** Leaves the page for Google. */
  navigate: (url: string) => void
}>

export type GuestResponseHandlerInput = GuestResponseSetters &
  Readonly<{
    actions: GuestResponseActions
    token: string
    /** The nonce of the current signed session; it rotates when a guest starts over. */
    csrfNonce: string
    googleReviewAvailable: boolean
  }>

export type GuestResponseHandlers = Readonly<{
  onSubmitRating: (value: RatingSubmission) => Promise<void>
  onChangeRating: (value: RatingSubmission) => Promise<void>
  onSubmitNote: (value: NoteSubmission) => Promise<boolean>
  onGoogleReview: () => void
  onRemoveNote: () => void
  onRemoveResponse: () => void
  onStartOver: () => void
}>

export function buildGuestResponseHandlers(
  input: GuestResponseHandlerInput,
): GuestResponseHandlers {
  const { actions, token, csrfNonce, googleReviewAvailable } = input
  const session = { token, csrfNonce }

  /** Runs one call: clears the last message, and names the card that failed if it does. */
  const attempt = async <T>(
    failure: ImmersiveResponseFailure,
    call: () => Promise<T>,
  ): Promise<T | null> => {
    input.setFailure(null)
    input.setNotice(null)
    try {
      return await call()
    } catch {
      input.setFailure(failure)
      return null
    }
  }

  const rate = (
    action: GuestResponseActions['submitResponse'],
    value: RatingSubmission,
    notice: ImmersiveResponseNotice | null,
  ) =>
    attempt('rating', () =>
      action({
        data: {
          ...session,
          rating: value.rating,
          responseConsent: true,
          honeypot: value.honeypot,
        },
      }),
    ).then((next) => {
      if (next === null) return
      input.setResponse(next)
      if (notice) input.setNotice(notice)
    })

  return {
    onSubmitRating: (value) => rate(actions.submitResponse, value, null),
    onChangeRating: (value) => rate(actions.correctResponse, value, 'rating-updated'),
    onSubmitNote: async (value) => {
      const next = await attempt('note', () =>
        actions.submitPrivateFeedback({
          data: {
            ...session,
            text: value.text,
            textConsent: true,
            honeypot: value.honeypot,
          },
        }),
      )
      if (next === null) return false
      input.setResponse(next)
      return true
    },
    onGoogleReview: () => {
      if (!googleReviewAvailable) return
      void attempt('google', async () => {
        const { url } = await actions.selectGoogleReview({ data: session })
        // Never an arbitrary redirect (ADR 0044 abuse rule 4): the server hands
        // back Google's address, and anything else is a failure, not a trip.
        if (!isHttpsUrl(url)) throw new Error('not an https address')
        input.navigate(url)
      })
    },
    onRemoveNote: () => {
      void attempt('remove-note', () =>
        actions.withdrawPrivateFeedback({ data: session }),
      ).then((next) => {
        if (next === null) return
        input.setResponse(next)
        input.setNotice('note-removed')
      })
    },
    onRemoveResponse: () => {
      void attempt('remove-all', () => actions.withdrawResponse({ data: session })).then(
        (next) => {
          if (next !== null) input.setResponse(next)
        },
      )
    },
    onStartOver: () => {
      void attempt('start-over', () => actions.startNewResponse({ data: session })).then(
        (next) => {
          if (next === null) return
          input.setCsrfNonce(next.csrfNonce)
          input.setResponse(null)
          input.setNotice('started-over')
        },
      )
    },
  }
}
