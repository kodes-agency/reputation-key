import type { ReactNode } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { GuestPrivateFeedbackForm } from './guest-private-feedback-form'
import { GuestPrivateFeedbackReceipt } from './guest-private-feedback-receipt'
import { GuestRatingForm } from './guest-rating-form'
import { GuestResponseWithdrawal } from './guest-response-withdrawal'
import { GuestResponseSessionReset } from './guest-response-session-reset'
import { GuestRatingCorrection } from './guest-rating-correction'
import type { GuestPortalCopy } from './guest-language-pack'
import {
  GoogleReviewAction,
  GuestGatewayLoading,
  GuestGatewayUnavailable,
  GuestWithdrawnReceipt,
} from './guest-response-state-panels'

type MutationState = Readonly<{ isPending?: boolean; error?: unknown }>
type RatingValue = Readonly<{ rating: number; honeypot: string }>
type FeedbackValue = Readonly<{ text: string; honeypot: string }>

type GuestResponseFormViewProps = Readonly<{
  availability: 'available' | 'loading' | 'permission_denied' | 'error'
  copy: GuestPortalCopy
  response: GuestResponseView | null
  googleReviewAvailable: boolean
  correcting: boolean
  pending: boolean
  message: string
  submitRatingMutation: MutationState
  submitFeedbackMutation: MutationState
  secondaryLinks?: ReactNode
  onSubmitRating: (value: RatingValue) => Promise<void>
  onSubmitFeedback: (value: FeedbackValue) => Promise<boolean>
  onGoogleReview: () => void
  onStartCorrection: () => void
  onStartNewResponse: () => void
  onWithdrawFeedback: () => void
  onWithdraw: () => void
}>

export function GuestResponseFormView(props: GuestResponseFormViewProps) {
  if (props.availability === 'loading') return <GuestGatewayLoading />
  if (props.availability !== 'available') {
    return <GuestGatewayUnavailable copy={props.copy} />
  }
  if (props.response?.status === 'deleted') {
    return <GuestWithdrawnReceipt copy={props.copy} />
  }
  if (!props.response) return <InitialRatingForm {...props} />
  return <RatedResponseView {...props} response={props.response} />
}

function InitialRatingForm(props: GuestResponseFormViewProps) {
  return (
    <section aria-labelledby="private-rating-heading" className="rounded-lg border p-5">
      <h2 id="private-rating-heading" className="text-lg font-semibold">
        {props.copy.previewRatingTitle}
      </h2>
      <p className="mt-1 text-sm">{props.copy.previewRatingBody}</p>
      <GuestRatingForm
        idPrefix="guest-rating"
        initialRating={null}
        mutation={{
          isPending: props.submitRatingMutation.isPending === true,
          error: props.submitRatingMutation.error,
        }}
        copy={props.copy}
        submitLabel={props.copy.submitPrivateRating}
        className="mt-5 space-y-4"
        buttonClassName="w-full bg-[color:var(--portal-primary)] text-[color:var(--portal-on-primary)] hover:bg-[color:var(--portal-primary)] hover:opacity-90 focus-visible:ring-[color:var(--portal-primary)]"
        onSubmit={props.onSubmitRating}
      />
      <p className="mt-3 text-sm" aria-live="polite">
        {props.message}
      </p>
    </section>
  )
}

function RatedResponseView(
  props: GuestResponseFormViewProps & { response: GuestResponseView },
) {
  const { response } = props
  if (response.rating === null) return <GuestWithdrawnReceipt copy={props.copy} />
  return (
    <section aria-labelledby="rating-receipt-heading" className="space-y-5">
      <div className="rounded-lg border p-5 text-center">
        <h2 id="rating-receipt-heading" className="font-semibold">
          {props.copy.privateRatingThanks}
        </h2>
        <p className="mt-1 text-sm">{props.copy.ratedExperience(response.rating)}</p>
      </div>
      <GoogleReviewAction
        available={props.googleReviewAvailable}
        pending={props.pending}
        onSelect={props.onGoogleReview}
        copy={props.copy}
      />
      {response.privateFeedbackEligible && !response.hasPrivateFeedback && (
        <GuestPrivateFeedbackForm
          mutation={{
            isPending: props.submitFeedbackMutation.isPending === true,
            error: props.submitFeedbackMutation.error,
          }}
          onSubmit={props.onSubmitFeedback}
          copy={props.copy}
        />
      )}
      <GuestPrivateFeedbackReceipt
        response={response}
        pending={props.pending}
        onWithdraw={props.onWithdrawFeedback}
        copy={props.copy}
      />
      {response.correctionAvailable && (
        <GuestRatingCorrection
          rating={response.rating}
          correcting={props.correcting}
          mutation={{
            isPending: props.submitRatingMutation.isPending === true,
            error: props.submitRatingMutation.error,
          }}
          correctionDeadline={response.correctionDeadline}
          onSubmit={props.onSubmitRating}
          onStart={props.onStartCorrection}
          copy={props.copy}
        />
      )}
      <GuestResponseWithdrawal
        response={response}
        pending={props.pending}
        onWithdraw={props.onWithdraw}
        copy={props.copy}
      />
      <GuestResponseSessionReset
        pending={props.pending}
        onStart={props.onStartNewResponse}
        copy={props.copy}
      />
      <p className="text-sm" aria-live="polite">
        {props.message}
      </p>
      {props.secondaryLinks}
    </section>
  )
}
