import { useState, type FormEvent } from 'react'
import { GuestResponseFormView } from './guest-response-form-view'
import type { GuestResponseFormProps } from './guest-response-form-types'
export type {
  GuestResponseAction,
  GuestResponseFormProps,
} from './guest-response-form-types'

export function GuestResponseForm({
  token,
  csrfNonce,
  googleReview,
  secondaryLinks,
  initialResponse,
  availability = 'available',
  submitResponse,
  correctResponse,
  startNewResponse,
  submitPrivateFeedback,
  selectGoogleReview,
  withdrawResponse,
  withdrawPrivateFeedback,
}: GuestResponseFormProps) {
  const [response, setResponse] = useState(initialResponse)
  const [activeCsrfNonce, setActiveCsrfNonce] = useState(csrfNonce)
  const [rating, setRating] = useState<number | null>(initialResponse?.rating ?? null)
  const [feedback, setFeedback] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const googleReviewAvailable = googleReview.status === 'available'

  const submitRating = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (rating === null) {
      setMessage('Choose a rating from 1 to 5 stars.')
      return
    }
    setPending(true)
    setMessage('')
    try {
      const action = correcting ? correctResponse : submitResponse
      const next = await action({
        data: {
          token,
          csrfNonce: activeCsrfNonce,
          rating,
          responseConsent: true,
          honeypot,
        },
      })
      setResponse(next)
      setCorrecting(false)
      setMessage(
        correcting
          ? 'Your private rating was updated.'
          : 'Thank you. Your private rating was submitted.',
      )
    } catch {
      setMessage('Your rating could not be saved. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const submitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = feedback.trim()
    if (!text) {
      setMessage('Write your private feedback before sending it.')
      return
    }
    setPending(true)
    setMessage('')
    try {
      const next = await submitPrivateFeedback({
        data: {
          token,
          csrfNonce: activeCsrfNonce,
          text,
          textConsent: true,
          honeypot,
        },
      })
      setResponse(next)
      setFeedback('')
      setMessage('Your private feedback was sent to the property team.')
    } catch {
      setMessage('Your private feedback could not be sent. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const openGoogleReview = async () => {
    if (!googleReviewAvailable) return
    setPending(true)
    try {
      const result = await selectGoogleReview({
        data: { token, csrfNonce: activeCsrfNonce },
      })
      window.location.assign(result.url)
    } catch {
      setMessage('The Google review link could not be opened. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const withdraw = async () => {
    setPending(true)
    setMessage('')
    try {
      setResponse(await withdrawResponse({ data: { token, csrfNonce: activeCsrfNonce } }))
    } catch {
      setMessage('Your response could not be withdrawn. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const withdrawFeedback = async () => {
    setPending(true)
    setMessage('')
    try {
      setResponse(
        await withdrawPrivateFeedback({
          data: { token, csrfNonce: activeCsrfNonce },
        }),
      )
      setMessage(
        'Your private feedback was withdrawn. Your private rating remains saved.',
      )
    } catch {
      setMessage('Your private feedback could not be withdrawn. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const startAnotherResponse = async () => {
    setPending(true)
    setMessage('')
    try {
      const nextSession = await startNewResponse({
        data: { token, csrfNonce: activeCsrfNonce },
      })
      setActiveCsrfNonce(nextSession.csrfNonce)
      setResponse(null)
      setRating(null)
      setFeedback('')
      setCorrecting(false)
      setHoneypot('')
      setMessage('Ready for another response. The earlier response remains saved.')
    } catch {
      setMessage('A new response could not be started. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <GuestResponseFormView
      availability={availability}
      response={response}
      googleReviewAvailable={googleReviewAvailable}
      rating={rating}
      feedback={feedback}
      correcting={correcting}
      pending={pending}
      message={message}
      honeypot={honeypot}
      secondaryLinks={secondaryLinks?.(activeCsrfNonce)}
      onRatingChange={setRating}
      onFeedbackChange={setFeedback}
      onHoneypotChange={setHoneypot}
      onSubmitRating={submitRating}
      onSubmitFeedback={submitFeedback}
      onGoogleReview={() => void openGoogleReview()}
      onStartCorrection={() => setCorrecting(true)}
      onStartNewResponse={() => void startAnotherResponse()}
      onWithdrawFeedback={() => void withdrawFeedback()}
      onWithdraw={() => void withdraw()}
    />
  )
}
