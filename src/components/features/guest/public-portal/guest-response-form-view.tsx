import type { FormEvent, ReactNode } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { Honeypot, RatingChoices } from './guest-response-fields'
import { GuestPrivateFeedbackForm } from './guest-private-feedback-form'

type FormHandler = (event: FormEvent<HTMLFormElement>) => void

type GuestResponseFormViewProps = Readonly<{
  availability: 'available' | 'loading' | 'permission_denied' | 'error'
  response: GuestResponseView | null
  googleReviewAvailable: boolean
  rating: number | null
  feedback: string
  correcting: boolean
  pending: boolean
  message: string
  honeypot: string
  secondaryLinks?: ReactNode
  onRatingChange: (value: number) => void
  onFeedbackChange: (value: string) => void
  onHoneypotChange: (value: string) => void
  onSubmitRating: FormHandler
  onSubmitFeedback: FormHandler
  onGoogleReview: () => void
  onStartCorrection: () => void
  onWithdraw: () => void
}>

export function GuestResponseFormView(props: GuestResponseFormViewProps) {
  if (props.availability === 'loading') return <GatewayLoading />
  if (props.availability !== 'available') return <GatewayUnavailable />
  if (props.response?.status === 'deleted') return <WithdrawnReceipt />
  if (!props.response) return <InitialRatingForm {...props} />
  return <RatedResponseView {...props} response={props.response} />
}

function GatewayLoading() {
  return (
    <section aria-busy="true" className="rounded-lg border p-5">
      <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
      <div className="mt-4 h-20 animate-pulse rounded bg-gray-100" />
    </section>
  )
}

function GatewayUnavailable() {
  return (
    <section role="status" className="rounded-lg border p-5 text-center">
      <h2 className="font-semibold">Review gateway temporarily unavailable</h2>
      <p className="mt-2 text-sm">Please try again in a little while.</p>
    </section>
  )
}

function WithdrawnReceipt() {
  return (
    <section role="status" className="rounded-lg border p-5 text-center">
      <h2 className="font-semibold">Your response was withdrawn</h2>
      <p className="mt-2 text-sm">Its private rating and feedback were removed.</p>
    </section>
  )
}

function InitialRatingForm(props: GuestResponseFormViewProps) {
  return (
    <section aria-labelledby="private-rating-heading" className="rounded-lg border p-5">
      <h2 id="private-rating-heading" className="text-lg font-semibold">
        How was your experience?
      </h2>
      <p className="mt-1 text-sm">
        Start with a private 1–5 star rating. Submitting shares it with the property team.
      </p>
      <form className="mt-5 space-y-4" onSubmit={props.onSubmitRating}>
        <RatingChoices
          value={props.rating}
          disabled={props.pending}
          onChange={props.onRatingChange}
        />
        <Honeypot value={props.honeypot} onChange={props.onHoneypotChange} />
        <button
          type="submit"
          disabled={props.pending}
          className="w-full rounded-lg bg-[color:var(--portal-primary)] px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {props.pending ? 'Submitting…' : 'Submit private rating'}
        </button>
      </form>
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
  return (
    <section aria-labelledby="rating-receipt-heading" className="space-y-5">
      <div className="rounded-lg border p-5 text-center">
        <h2 id="rating-receipt-heading" className="font-semibold">
          Thank you for your private rating
        </h2>
        <p className="mt-1 text-sm">You rated this experience {response.rating}/5.</p>
      </div>
      <GoogleReviewAction
        available={props.googleReviewAvailable}
        pending={props.pending}
        onSelect={props.onGoogleReview}
      />
      {response.privateFeedbackEligible && !response.hasPrivateFeedback && (
        <GuestPrivateFeedbackForm
          feedback={props.feedback}
          honeypot={props.honeypot}
          pending={props.pending}
          onFeedbackChange={props.onFeedbackChange}
          onHoneypotChange={props.onHoneypotChange}
          onSubmit={props.onSubmitFeedback}
        />
      )}
      {response.hasPrivateFeedback && (
        <p role="status" className="rounded-lg border p-4 text-sm">
          Your private feedback was sent to the property team. Its text is not shown again
          on this device.
        </p>
      )}
      {response.status === 'submitted' && <RatingCorrection {...props} />}
      <button
        type="button"
        disabled={props.pending}
        onClick={props.onWithdraw}
        className="text-sm underline disabled:opacity-50"
      >
        Withdraw my response
      </button>
      <p className="text-sm" aria-live="polite">
        {props.message}
      </p>
      {props.secondaryLinks}
    </section>
  )
}

function GoogleReviewAction({
  available,
  pending,
  onSelect,
}: Readonly<{ available: boolean; pending: boolean; onSelect: () => void }>) {
  if (!available) {
    return (
      <div role="status" className="rounded-lg border p-5 text-center">
        <h2 className="text-lg font-semibold">Google review link unavailable</h2>
        <p className="mt-1 text-sm">
          The Google review link isn’t available right now. Your private rating is saved,
          and you can continue with the options below.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border p-5 text-center">
      <h2 className="text-lg font-semibold">Share your experience on Google</h2>
      <p className="mt-1 text-sm">
        If you would like, you can also leave a public Google review.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={onSelect}
        className="mt-4 w-full rounded-lg bg-[color:var(--portal-primary)] px-4 py-3 font-semibold text-white disabled:opacity-50"
      >
        Continue to Google
      </button>
    </div>
  )
}

function RatingCorrection(props: GuestResponseFormViewProps) {
  return (
    <div className="rounded-lg border p-4">
      {props.correcting ? (
        <form className="space-y-4" onSubmit={props.onSubmitRating}>
          <RatingChoices
            value={props.rating}
            disabled={props.pending}
            onChange={props.onRatingChange}
          />
          <button
            type="submit"
            disabled={props.pending}
            className="rounded-lg border border-current px-4 py-2 font-medium disabled:opacity-50"
          >
            Save rating correction
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={props.onStartCorrection}
          className="text-sm underline"
        >
          Change your private rating
        </button>
      )}
    </div>
  )
}
