import { Star } from 'lucide-react'

import { cn } from '#/lib/utils'

type Props = Readonly<{
  /** Filled stars. Clamped to 0…max. */
  value: number
  max?: number
  className?: string
  /**
   * Accessible sentence. Colour and glyph alone never carry the rating, so a
   * text equivalent is always rendered (visually hidden by default).
   */
  label?: string
}>

/**
 * Star rating drawn as real glyphs. The stars are `aria-hidden` SVG — the
 * rating reaches assistive tech through the sibling text, never through shape
 * or colour.
 */
export function StarRating({ value, max = 5, className, label }: Props) {
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
            'size-3',
            index < filled ? 'fill-current text-foreground' : 'text-muted-foreground/40',
          )}
        />
      ))}
      <span className="sr-only">{label ?? `${filled} out of ${max} stars`}</span>
    </span>
  )
}
