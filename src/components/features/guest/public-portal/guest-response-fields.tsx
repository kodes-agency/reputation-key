const RATINGS = [1, 2, 3, 4, 5] as const

function ratingLabel(value: number): string {
  return `${value} ${value === 1 ? 'star' : 'stars'}`
}

export function RatingChoices({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: number | null
  disabled: boolean
  onChange: (rating: number) => void
}>) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium">Your private rating</legend>
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Rating">
        {RATINGS.map((rating) => (
          <label
            key={rating}
            className="cursor-pointer rounded-lg border p-3 text-center focus-within:ring-2 focus-within:ring-[color:var(--portal-primary)]"
          >
            <input
              className="sr-only"
              type="radio"
              name="guest-rating"
              aria-label={ratingLabel(rating)}
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
  value,
  onChange,
}: Readonly<{ value: string; onChange: (value: string) => void }>) {
  return (
    <div aria-hidden="true" className="absolute left-[-9999px] size-0 overflow-hidden">
      <label htmlFor="guest-response-website">Website</label>
      <input
        id="guest-response-website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
