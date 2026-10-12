import { Star } from 'lucide-react'

import { cn } from '#/lib/utils'

// The glyph beside a figure, sized to the figure: the list cell's text, a
// summary strip's value and a KPI tile's headline number.
const STAR_SIZE = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-6',
} as const

export type RatingFigureSize = keyof typeof STAR_SIZE

export type RatingFigureProps = Readonly<{
  /** The rating out of five, printed to one decimal. */
  value: number
  size?: RatingFigureSize
  className?: string
}>

/**
 * A rating as a number with one star after it (UI consistency scan: COLL-09).
 * The star is the product's gold, `--rating`, the only gold a star wears; it was
 * a `★` character in the ink of the figure on two pages and a token star on two
 * others. The number is the content, so the star is decorative and a screen
 * reader hears "4.3 stars" rather than "4.3 black star". For five stars in a
 * row, or one where the count of filled glyphs is the only carrier of the score,
 * use `StarRating`.
 */
export function RatingFigure({ value, size = 'sm', className }: RatingFigureProps) {
  return (
    <span
      data-slot="rating-figure"
      className={cn('inline-flex items-center gap-1', className)}
    >
      <span className="tabular-nums">{value.toFixed(1)}</span>
      <Star
        className={cn(STAR_SIZE[size], 'shrink-0 fill-current text-rating')}
        aria-hidden="true"
      />
      <span className="sr-only">stars</span>
    </span>
  )
}
