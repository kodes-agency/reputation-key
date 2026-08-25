import { useState, type FormEvent, type ReactNode } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { PublicGoogleReviewDestination } from '#/contexts/portal/application/public-api'
import { GuestResponseFormView } from './guest-response-form-view'

export type GuestResponseAction<TInput, TResult> = (input: {
  data: TInput
}) => Promise<TResult>

type GuestRatingPayload = Readonly<{
  token: string
  csrfNonce: string
  rating: number
  responseConsent: true
  honeypot?: string
}>

type GuestPrivateFeedbackPayload = Readonly<{
  token: string
  csrfNonce: string
  text: string
  textConsent: true
  honeypot?: string
}>

export type GuestResponseFormProps = Readonly<{
  token: string
  csrfNonce: string
  googleReview: PublicGoogleReviewDestination
  secondaryLinks?: ReactNode
  initialResponse: GuestResponseView | null
  availability?: 'available' | 'loading' | 'permission_denied' | 'error'
  submitResponse: GuestResponseAction<GuestRatingPayload, GuestResponseView>
  correctResponse: GuestResponseAction<GuestRatingPayload, GuestResponseView>
  submitPrivateFeedback: GuestResponseAction<
    GuestPrivateFeedbackPayload,
    GuestResponseView
  >
  selectGoogleReview: GuestResponseAction<
    { token: string; csrfNonce: string },
    { url: string }
  >
  withdrawResponse: GuestResponseAction<
    { token: string; csrfNonce: string },
    GuestResponseView
  >
  withdrawPrivateFeedback: GuestResponseAction<
    { token: string; csrfNonce: string },
    GuestResponseView
  >
}>

export function GuestResponseForm({
  token,
  csrfNonce,
  googleReview,
  secondaryLinks,
  initialResponse,
  availability = 'available',
  submitResponse,
  correctResponse,
  submitPrivateFeedback,
  selectGoogleReview,
  withdrawResponse,
  withdrawPrivateFeedback,
}: GuestResponseFormProps) {
  const [response, setResponse] = useState(initialResponse)
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
          csrfNonce,
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
        data: { token, csrfNonce, text, textConsent: true, honeypot },
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
      const result = await selectGoogleReview({ data: { token, csrfNonce } })
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
      setResponse(await withdrawResponse({ data: { token, csrfNonce } }))
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
      setResponse(await withdrawPrivateFeedback({ data: { token, csrfNonce } }))
      setMessage(
        'Your private feedback was withdrawn. Your private rating remains saved.',
      )
    } catch {
      setMessage('Your private feedback could not be withdrawn. Please try again.')
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
      secondaryLinks={secondaryLinks}
      onRatingChange={setRating}
      onFeedbackChange={setFeedback}
      onHoneypotChange={setHoneypot}
      onSubmitRating={submitRating}
      onSubmitFeedback={submitFeedback}
      onGoogleReview={() => void openGoogleReview()}
      onStartCorrection={() => setCorrecting(true)}
      onWithdrawFeedback={() => void withdrawFeedback()}
      onWithdraw={() => void withdraw()}
    />
  )
}
