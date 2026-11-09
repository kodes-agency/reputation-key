import { Star } from 'lucide-react'

import { cn } from '#/lib/utils'

/**
 * Glyph size per scale. `xs` (12 px) is the default so stars sit level with the
 * `size-3` icons and `text-xs` facts of the notification meta strip; `sm` is
 * the thread's fact scale (Tailwind has no 13 px step).
 */
const SIZE_CLASS = {
  xs: 'size-3',
  sm: 'size-[13px]',
} as const

/**
 * Filled-glyph tone; the empty glyph is the same muted outline in both.
 *
 * `foreground` is the default: the notification strip renders five glyphs with
 * no printed number, so filled-versus-empty is the only carrier of the score.
 * `rating` (amber, the one gold a star wears in the product) fails WCAG 1.4.11's
 * 3:1 against the empty glyph on every light surface (about 1.3:1), including
 * the unread notification row's `--surface-elevated`. A caller opts in only
 * beside `showValue`, where the printed number carries the score.
 *
 * `src/components/ui/**` may not import a feature module, so this names the
 * `--rating` token directly.
 */
const TONE_CLASS = {
  foreground: 'fill-current text-foreground',
  rating: 'fill-current text-rating',
} as const
const EMPTY_CLASS = 'text-muted-foreground/40'

type Props = Readonly<{
  /** Filled stars. Clamped to 0…max. */
  value: number
  /** Glyphs drawn, and the denominator of the accessible sentence. */
  max?: number
  /** Glyph size: `xs` 12 px (default), `sm` 13 px. */
  size?: keyof typeof SIZE_CLASS
  /** Filled-glyph tone: `foreground` (default) or the `rating` amber. */
  tone?: keyof typeof TONE_CLASS
  /**
   * Print the value beside the stars, tabular so columns of ratings do not
   * wobble. The printed number is `value`, never the clamped glyph count: `max`
   * is a glyph count, not a scale.
   */
  showValue?: boolean
  className?: string
  /**
   * Accessible sentence, visually hidden by default. Ignored when `showValue`
   * is on: the hidden span then narrows to the unit so a screen reader says
   * "4.0 out of 5 stars" rather than repeating the rating.
   */
  label?: string
}>

/**
 * Star rating drawn as real glyphs. The stars are `aria-hidden` SVG — the
 * rating reaches assistive tech through the sibling text, never through shape
 * or colour.
 */
export function StarRating({
  value,
  max = 5,
  size = 'xs',
  tone = 'foreground',
  showValue = false,
  className,
  label,
}: Props) {
  const filled = Math.max(0, Math.min(max, Math.round(value)))

  return (
    <span
      data-slot="star-rating"
      className={cn('inline-flex items-center gap-px align-middle', className)}
    >
      {Array.from({ length: max }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={cn(
            SIZE_CLASS[size],
            index < filled ? TONE_CLASS[tone] : EMPTY_CLASS,
          )}
        />
      ))}
      {showValue && (
        <span data-slot="star-rating-value" className="ml-1 tabular-nums">
          {value.toFixed(1)}
        </span>
      )}
      <span className="sr-only">
        {showValue ? `out of ${max} stars` : (label ?? `${filled} out of ${max} stars`)}
      </span>
    </span>
  )
}
