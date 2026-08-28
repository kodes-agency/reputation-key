import type { ReactNode } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import type { PublicGoogleReviewDestination } from '#/contexts/portal/application/public-api'
import type {
  GuestPortalLanguagePackVersion,
  GuestPortalLocale,
} from './guest-language-pack'

export type GuestResponseAction<TInput, TResult> = ((input: {
  data: TInput
}) => Promise<TResult>) &
  Readonly<{
    /** Present on actions produced by the sanctioned action hook. Optional for test fakes. */
    isPending?: boolean
    error?: unknown
  }>

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
  locale?: GuestPortalLocale
  languagePackVersion?: GuestPortalLanguagePackVersion
  /** Browser display needs availability only; the server returns the URI after selection. */
  googleReview: Readonly<{ status: PublicGoogleReviewDestination['status'] }>
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
