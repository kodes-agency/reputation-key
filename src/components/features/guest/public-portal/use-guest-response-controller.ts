import { useState } from 'react'
import { useAction } from '#/components/hooks/use-action'
import type { GuestResponseFormProps } from './guest-response-form-types'
import type { GuestPortalCopy } from './guest-language-pack'

export function useGuestResponseController(
  props: GuestResponseFormProps,
  copy: GuestPortalCopy,
) {
  const {
    token,
    csrfNonce,
    initialResponse,
    submitResponse,
    correctResponse,
    startNewResponse,
    submitPrivateFeedback,
    selectGoogleReview,
    withdrawResponse,
    withdrawPrivateFeedback,
  } = props
  const [response, setResponse] = useState(initialResponse)
  const [activeCsrfNonce, setActiveCsrfNonce] = useState(csrfNonce)
  const [correcting, setCorrecting] = useState(false)
  const [message, setMessage] = useState('')
  // Session rotation also refreshes the route cache, so wrap that composed
  // callback here to expose the same sanctioned state as direct server actions.
  const startNewResponseAction = useAction(startNewResponse)
  const googleReviewAvailable = props.googleReview.status === 'available'
  const pending = [
    submitResponse,
    correctResponse,
    startNewResponseAction,
    submitPrivateFeedback,
    selectGoogleReview,
    withdrawResponse,
    withdrawPrivateFeedback,
  ].some((action) => action.isPending === true)
  const requestData = () => ({ token, csrfNonce: activeCsrfNonce })

  const onSubmitRating = async (
    value: Readonly<{ rating: number; honeypot: string }>,
  ) => {
    setMessage('')
    try {
      const action = correcting ? correctResponse : submitResponse
      const next = await action({
        data: {
          ...requestData(),
          rating: value.rating,
          responseConsent: true,
          honeypot: value.honeypot,
        },
      })
      setResponse(next)
      setCorrecting(false)
      setMessage(correcting ? copy.ratingUpdated : copy.ratingSubmitted)
    } catch {
      setMessage(copy.ratingSaveFailed)
    }
  }

  const onSubmitFeedback = async (
    value: Readonly<{ text: string; honeypot: string }>,
  ) => {
    setMessage('')
    try {
      setResponse(
        await submitPrivateFeedback({
          data: {
            ...requestData(),
            text: value.text,
            textConsent: true,
            honeypot: value.honeypot,
          },
        }),
      )
      setMessage(copy.feedbackSent)
      return true
    } catch {
      setMessage(copy.feedbackSaveFailed)
      return false
    }
  }

  const onGoogleReview = async () => {
    if (!googleReviewAvailable) return
    try {
      const result = await selectGoogleReview({ data: requestData() })
      window.location.assign(result.url)
    } catch {
      setMessage(copy.googleOpenFailed)
    }
  }

  const onWithdraw = async () => {
    setMessage('')
    try {
      setResponse(await withdrawResponse({ data: requestData() }))
    } catch {
      setMessage(copy.responseWithdrawFailed)
    }
  }

  const onWithdrawFeedback = async () => {
    setMessage('')
    try {
      setResponse(await withdrawPrivateFeedback({ data: requestData() }))
      setMessage(copy.feedbackWithdrawnRatingSaved)
    } catch {
      setMessage(copy.feedbackWithdrawFailed)
    }
  }

  const onStartNewResponse = async () => {
    setMessage('')
    try {
      const nextSession = await startNewResponseAction({ data: requestData() })
      setActiveCsrfNonce(nextSession.csrfNonce)
      setResponse(null)
      setCorrecting(false)
      setMessage(copy.newResponseReady)
    } catch {
      setMessage(copy.newResponseFailed)
    }
  }

  return {
    response,
    activeCsrfNonce,
    googleReviewAvailable,
    correcting,
    pending,
    message,
    submitRatingMutation: response ? correctResponse : submitResponse,
    submitFeedbackMutation: submitPrivateFeedback,
    onSubmitRating,
    onSubmitFeedback,
    onGoogleReview: () => void onGoogleReview(),
    onStartCorrection: () => setCorrecting(true),
    onStartNewResponse: () => void onStartNewResponse(),
    onWithdrawFeedback: () => void onWithdrawFeedback(),
    onWithdraw: () => void onWithdraw(),
  }
}
