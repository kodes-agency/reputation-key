import type { FormEventHandler } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { GuestResponseFields } from './guest-response-fields'

const correctionDeadlineFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatCorrectionDeadline(value: Date | string): string {
  return `${correctionDeadlineFormatter.format(new Date(value))} UTC`
}

export type GuestResponseFormViewProps = Readonly<{
  availability: 'available' | 'loading' | 'permission_denied' | 'error'
  mediaEnabled: boolean
  response: GuestResponseView | null
  rating: number | null
  text: string
  responseConsent: boolean
  textConsent: boolean
  mediaConsent: boolean
  pending: boolean
  message: string
  honeypot: string
  isCorrecting: boolean
  isTerminal: boolean
  onSubmit: FormEventHandler<HTMLFormElement>
  onWithdraw: () => void
  onRatingChange: (rating: number) => void
  onTextChange: (text: string) => void
  onResponseConsentChange: (consented: boolean) => void
  onTextConsentChange: (consented: boolean) => void
  onMediaConsentChange: (consented: boolean) => void
  onHoneypotChange: (value: string) => void
  onFileChange: (file: File | null) => void
}>

export function GuestResponseFormView(props: GuestResponseFormViewProps) {
  if (props.availability === 'loading') {
    return (
      <section
        aria-busy="true"
        aria-label="Loading optional feedback"
        className="rounded-lg border p-4"
      >
        <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 h-20 animate-pulse rounded bg-gray-100" />
      </section>
    )
  }

  if (props.availability === 'permission_denied' || props.availability === 'error') {
    return (
      <section aria-labelledby="guest-response-heading" className="rounded-lg border p-4">
        <h2 id="guest-response-heading" className="font-semibold">
          Optional feedback
        </h2>
        <p
          className="mt-2 text-sm"
          role={props.availability === 'error' ? 'alert' : undefined}
        >
          {props.availability === 'permission_denied'
            ? 'Optional feedback is not available for this portal.'
            : props.message || 'Optional feedback is temporarily unavailable.'}
        </p>
      </section>
    )
  }

  if (props.response?.status === 'deleted') {
    return (
      <section aria-labelledby="guest-response-heading" className="rounded-lg border p-4">
        <h2 id="guest-response-heading" className="font-semibold">
          Optional feedback
        </h2>
        <p className="mt-2 text-sm">Your response has been withdrawn.</p>
        <p className="sr-only" aria-live="polite">
          {props.message}
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="guest-response-heading" className="rounded-lg border p-4">
      <h2 id="guest-response-heading" className="font-semibold">
        Optional feedback
      </h2>
      <p className="mt-1 text-sm">
        Destinations above remain available whether you respond or decline.
      </p>
      <GuestResponseFields {...props} />

      {props.response && (
        <div className="mt-4 border-t pt-4">
          {props.response.correctionDeadline && props.response.status === 'submitted' && (
            <p className="text-sm">
              One correction is available until{' '}
              {formatCorrectionDeadline(props.response.correctionDeadline)}.
            </p>
          )}
          <button
            type="button"
            disabled={props.pending}
            onClick={props.onWithdraw}
            className="mt-2 rounded border border-current px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Withdraw response
          </button>
        </div>
      )}
      <p className="mt-3 text-sm" aria-live="polite">
        {props.message}
      </p>
    </section>
  )
}
