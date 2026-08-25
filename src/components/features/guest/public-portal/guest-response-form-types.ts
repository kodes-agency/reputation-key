import type { ReactNode } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { PublicGoogleReviewDestination } from '#/contexts/portal/application/public-api'

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
  secondaryLinks?: (csrfNonce: string) => ReactNode
  initialResponse: GuestResponseView | null
  availability?: 'available' | 'loading' | 'permission_denied' | 'error'
  submitResponse: GuestResponseAction<GuestRatingPayload, GuestResponseView>
  correctResponse: GuestResponseAction<GuestRatingPayload, GuestResponseView>
  startNewResponse: GuestResponseAction<
    { token: string; csrfNonce: string },
    { csrfNonce: string }
  >
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
