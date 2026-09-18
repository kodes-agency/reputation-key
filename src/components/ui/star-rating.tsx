import { Star } from 'lucide-react'

import { cn } from '#/lib/utils'

/**
 * Glyph size per scale.
 *
 * `xs` (12 px, `size-3`) is the DEFAULT because it is what this primitive
 * shipped with, and it has a caller that passes no size: the notification meta
 * strip (`notification-row-meta.tsx:44`), a wrapping row of `text-xs` facts
 * whose sibling `Clock` and `Layers` glyphs are `size-3` too
 * (`notification-row-meta.tsx:50`, `:56`). A larger default would stand every
 * star in the feed taller than the icons and the text beside it. Plan row 7
 * asked for a 16 px default on the premise that this file was "present,
 * unused"; that premise was wrong, and no inbox caller needs 16 px, so the step
 * is not added.
 *
 * `sm` (13 px) is the thread's fact scale: the guest node prints one line
 * reading `name · stars · 5.0 · date` (plan row 10). Tailwind has no 13 px step
 * — `size-3` is 12 and `size-3.5` is 14 — so it is an arbitrary value.
 */
const SIZE_CLASS = {
  xs: 'size-3',
  sm: 'size-[13px]',
} as const

/**
 * Filled-glyph tone. The empty glyph is the same muted outline in both.
 *
 * `foreground` is the DEFAULT for the same reason `xs` is: it is what shipped,
 * and the notification strip renders five glyphs with NO printed number, so the
 * filled-versus-empty difference is the only visual carrier of the score there.
 * Measured (OKLCH → sRGB, the `/40` empty glyph alpha-blended onto the surface
 * in gamma-encoded sRGB as a browser does, then WCAG relative luminance),
 * filled glyph against empty glyph:
 *
 * The `rating` column is `--rating`, re-measured for the token; the third
 * column is the raw `amber-400` it replaced, kept because the guard below was
 * argued from it and the two are close enough that the argument is unchanged.
 *
 * | surface                    | `foreground` | `rating` | was `amber-400` |
 * | -------------------------- | ------------ | -------- | --------------- |
 * | light `--background`       | 9.73 : 1     | 1.31 : 1 | 1.13 : 1        |
 * | light `--surface-elevated` | 10.14 : 1    | 1.37 : 1 | 1.08 : 1        |
 * | light `--card`             | 10.15 : 1    | 1.37 : 1 | 1.08 : 1        |
 * | dark `--background`        | 7.97 : 1     | 5.51 : 1 | 5.71 : 1        |
 * | dark `--surface-elevated`  | 6.65 : 1     | 4.60 : 1 | 4.76 : 1        |
 * | dark `--card`              | 7.24 : 1     | 5.00 : 1 | 5.18 : 1        |
 *
 * `rating` fails WCAG 1.4.11's 3:1 on every light surface — darkening it for
 * the light theme moved 1.13 to 1.31, nowhere near the floor — and the unread
 * notification row sits on `--surface-elevated` (`notification-row.tsx:63`).
 * So `rating` is not the default and is not applied behind a caller's back.
 *
 * `rating` is the only gold a star in the product wears, because purple is
 * interactive-only (v1 row 12): the inbox list (`STAR_FILLED_CLASS`,
 * `inbox-detail-helpers.tsx`), the property dashboard
 * (`property-dashboard-helpers.tsx`) and the property list
 * (`property-list-cells.tsx`, `property-list-summary.tsx`) all spell it
 * `fill-current text-rating`, as this tone does. A caller opts in, and should
 * do so only beside `showValue`: with the number printed as text the glyphs are
 * decoration, the score does not depend on telling them apart, and the low
 * light-theme ratio above stops being a barrier. The guest node is that caller.
 *
 * `src/components/ui/**` may not import a feature module, so this names the
 * `--rating` token directly rather than reading `STAR_FILLED_CLASS`; both
 * resolve to the same custom property, in both themes. The list row cannot use
 * this primitive instead: its one star beside the rating is an icon, not a
 * rating out of one, and `max` is both the glyph count and the denominator
 * below, so `<StarRating max={1} …/>` would make it a score out of one.
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
   * Print the value beside the stars — `5.0`, tabular so a column of ratings
   * does not wobble as the digits change.
   *
   * The printed number is `value`, never the clamped glyph count: `max` is a
   * glyph count and not a scale, so printing the clamp would turn a one-glyph
   * `5` into `1.0` and would round 4.5 up to 5.0.
   */
  showValue?: boolean
  className?: string
  /**
   * Accessible sentence. Colour and glyph alone never carry the rating, so a
   * text equivalent is always rendered (visually hidden by default).
   *
   * Ignored when `showValue` is on. The number is on screen then, and a hidden
   * sentence that repeats it makes a screen reader say the rating twice ("4
   * out of 5 stars, 4.0"); instead the hidden span narrows to the unit and the
   * pair reads "4.0 out of 5 stars" in DOM order.
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
