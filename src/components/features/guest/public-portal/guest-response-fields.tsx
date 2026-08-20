import type { GuestResponseFormViewProps } from './guest-response-form-view'

/**
 * The editable response form. Split out of `guest-response-form-view` so that file
 * owns only the question of WHICH surface a guest sees (loading skeleton, capability
 * degradation copy, withdrawn notice, or this form) while the fields themselves live
 * here. Takes the view's whole prop object — there is no second contract to keep in
 * sync.
 */
export function GuestResponseFields(props: GuestResponseFormViewProps) {
  return (
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

      {/* Honeypot. A real guest can neither see nor reach it (off-screen, aria-hidden,
          removed from the tab order), so a non-empty value marks the submission as
          automated: the server answers with a fake-success response and writes
          nothing. Bound to state on purpose — an unbound input is dead HTML that
          never reaches the payload the server actually inspects. */}
      <div aria-hidden="true" className="absolute left-[-9999px] size-0 overflow-hidden">
        <label htmlFor="guest-response-website">Website</label>
        <input
          id="guest-response-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={props.honeypot}
          onChange={(event) => props.onHoneypotChange(event.target.value)}
        />
      </div>

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
  )
}
