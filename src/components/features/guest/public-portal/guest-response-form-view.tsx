import type { FormEventHandler } from 'react'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'

const correctionDeadlineFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatCorrectionDeadline(value: Date | string): string {
  return `${correctionDeadlineFormatter.format(new Date(value))} UTC`
}

type GuestResponseFormViewProps = Readonly<{
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
  isCorrecting: boolean
  isTerminal: boolean
  onSubmit: FormEventHandler<HTMLFormElement>
  onWithdraw: () => void
  onRatingChange: (rating: number) => void
  onTextChange: (text: string) => void
  onResponseConsentChange: (consented: boolean) => void
  onTextConsentChange: (consented: boolean) => void
  onMediaConsentChange: (consented: boolean) => void
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
      <form className="mt-4 space-y-5" onSubmit={props.onSubmit}>
        <fieldset disabled={props.pending || props.isTerminal} className="space-y-2">
          <legend className="text-sm font-medium">Optional rating</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className="cursor-pointer rounded border px-3 py-2">
                <input
                  className="mr-1"
                  type="radio"
                  name="guest-rating"
                  aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`}
                  value={value}
                  checked={props.rating === value}
                  onChange={() => props.onRatingChange(value)}
                />
                {value}
              </label>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.responseConsent}
              onChange={(event) => props.onResponseConsentChange(event.target.checked)}
            />
            Share this rating with the property team.
          </label>
        </fieldset>

        <fieldset disabled={props.pending || props.isTerminal} className="space-y-2">
          <legend className="text-sm font-medium">Optional written feedback</legend>
          <label htmlFor="guest-response-text" className="sr-only">
            Written feedback
          </label>
          <textarea
            id="guest-response-text"
            value={props.text}
            maxLength={2000}
            rows={4}
            onChange={(event) => props.onTextChange(event.target.value)}
            className="w-full rounded border p-3 focus:outline-none focus:ring-2"
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.textConsent}
              onChange={(event) => props.onTextConsentChange(event.target.checked)}
            />
            Share this written feedback with the property team.
          </label>
        </fieldset>

        {!props.isCorrecting && props.mediaEnabled && (
          <fieldset disabled={props.pending} className="space-y-2">
            <legend className="text-sm font-medium">Optional image</legend>
            <label htmlFor="guest-response-media" className="sr-only">
              Choose an optional image
            </label>
            <input
              id="guest-response-media"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => props.onFileChange(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs">One JPEG, PNG, or WebP image, up to 10 MiB.</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={props.mediaConsent}
                onChange={(event) => props.onMediaConsentChange(event.target.checked)}
              />
              Share this image with the property team.
            </label>
          </fieldset>
        )}
        {!props.isCorrecting && !props.mediaEnabled && (
          <p className="text-sm">Optional image sharing is currently unavailable.</p>
        )}

        {!props.isTerminal && (
          <button
            type="submit"
            disabled={props.pending}
            className="rounded bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {props.pending
              ? 'Saving…'
              : props.isCorrecting
                ? 'Save one correction'
                : 'Submit response'}
          </button>
        )}
      </form>

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
