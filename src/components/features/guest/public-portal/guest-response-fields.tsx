import type { GuestPortalCopy } from './guest-language-pack'

const RATINGS = [1, 2, 3, 4, 5] as const

export function RatingChoices({
  value,
  disabled,
  onChange,
  copy,
}: Readonly<{
  value: number | null
  disabled: boolean
  onChange: (rating: number) => void
  copy: GuestPortalCopy
}>) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium">{copy.privateRatingLegend}</legend>
      <div
        className="grid grid-cols-5 gap-2"
        role="radiogroup"
        aria-label={copy.ratingGroupLabel}
      >
        {RATINGS.map((rating) => (
          <label
            key={rating}
            className="cursor-pointer rounded-lg border p-3 text-center focus-within:ring-2 focus-within:ring-[color:var(--portal-primary)]"
          >
            <input
              className="sr-only"
              type="radio"
              name="guest-rating"
              aria-label={copy.ratingLabel(rating)}
              value={rating}
              checked={value === rating}
              onChange={() => onChange(rating)}
            />
            <span aria-hidden="true" className="block text-xl">
              ★
            </span>
            <span className="block text-xs">{rating}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function Honeypot({
  id,
  name,
  value,
  onChange,
  copy,
}: Readonly<{
  id: string
  name: string
  value: string
  onChange: (value: string) => void
  copy: GuestPortalCopy
}>) {
  return (
    <div aria-hidden="true" className="absolute left-[-9999px] size-0 overflow-hidden">
      <label htmlFor={id}>{copy.honeypotWebsite}</label>
      <input
        id={id}
        name={name}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
