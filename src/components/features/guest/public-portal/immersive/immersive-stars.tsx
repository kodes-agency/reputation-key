import { formatGuestPlural, guestCopyText } from '../guest-copy-format'
import type { GuestPortalCopyV2 } from '../language-packs/guest-copy-v2'

export const RATING_VALUES = [1, 2, 3, 4, 5] as const
type RatingValue = (typeof RATING_VALUES)[number]

/** The pack's word for a rating: "Poor" to "Excellent". */
export function ratingWord(pack: GuestPortalCopyV2, rating: number): string {
  const key = `ratingWord${rating as RatingValue}` as const
  return pack.copy[key]
}

/** "2 stars", with the locale's own plural form. */
export function starsLabel(pack: GuestPortalCopyV2, rating: number): string {
  return formatGuestPlural(pack.plurals.ratingStars, rating, pack.locale)
}

/** The v3 accessible name of one choice: "1 star, Poor". The legacy renderer keeps its own. */
export function ratingOptionName(pack: GuestPortalCopyV2, rating: number): string {
  return guestCopyText(pack, 'ratingOption', {
    stars: starsLabel(pack, rating),
    word: ratingWord(pack, rating),
  })
}

/** One outline star; filled when it counts toward the rating. Decorative. */
export function StarGlyph({ filled, size }: Readonly<{ filled: boolean; size: number }>) {
  return (
    <svg
      className="ih-star__glyph"
      data-filled={filled ? 'true' : 'false'}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
    >
      <path d="M12 3.2 14.6 8.6l5.9.8-4.3 4.1 1 5.9L12 16.6 6.8 19.4l1-5.9L3.5 9.4l5.9-.8Z" />
    </svg>
  )
}

/**
 * The five stars of the rating card: one radio group, each choice a 54 px
 * target holding a hidden native radio, so the keyboard, the arrow keys and
 * the screen reader's radio semantics come from the browser. Stars up to the
 * chosen one are filled; the chosen one sits on a lifted tile.
 */
export function RatingStars({
  pack,
  value,
  name,
  onChange,
}: Readonly<{
  pack: GuestPortalCopyV2
  /** 0 when nothing is chosen. */
  value: number
  name: string
  onChange: (rating: number) => void
}>) {
  return (
    <div className="ih-stars">
      {RATING_VALUES.map((rating) => (
        <label
          key={rating}
          className="ih-star"
          data-selected={value === rating ? 'true' : 'false'}
        >
          <input
            className="ih-sr-only"
            type="radio"
            name={name}
            value={rating}
            checked={value === rating}
            aria-label={ratingOptionName(pack, rating)}
            onChange={() => onChange(rating)}
          />
          <StarGlyph filled={rating <= value} size={32} />
        </label>
      ))}
    </div>
  )
}

/** The small stars of the receipt strip, as one image with a text name: "2 stars". */
export function ReceiptStars({
  pack,
  rating,
}: Readonly<{ pack: GuestPortalCopyV2; rating: number }>) {
  return (
    <span role="img" aria-label={starsLabel(pack, rating)} className="ih-receipt__stars">
      {RATING_VALUES.map((position) => (
        <StarGlyph key={position} filled={position <= rating} size={17} />
      ))}
    </span>
  )
}
