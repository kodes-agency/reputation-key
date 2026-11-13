// Inbox detail helpers — extracted from inbox-detail-sheet for line-count compliance.
//
// The guest node renders the shared primitive — `#/components/ui/star-rating` — with
// `tone="rating"`, which resolves to the same `--rating` token. The primitive's
// DEFAULT tone stays foreground: its notification caller shows no number beside
// the glyphs, and gold against the empty glyph is far too low a ratio to carry
// a score alone on a light surface (the measurements are on `TONE_CLASS` in
// that file).
//
// Purple is reserved for interactive elements, so ratings use the `--rating`
// gold, which the property dashboard and the property list resolve to as well.
// `STAR_FILLED_CLASS` serves exactly one caller: the list
// row's `RowIdentity` (`inbox-list-row.tsx`), which draws ONE filled,
// `aria-hidden` star beside the rating. That star is an icon standing for
// "rating", not a rating out of one, and the primitive cannot express it:
// `max` is both the glyph count and the denominator, so `max={1}` would make
// the star a score out of one, and `showValue` would print `5.0` where the row
// prints the rating as it is. The row therefore keeps its own star and this
// class. Both
// name the `--rating` CSS custom property rather than a raw `amber-400`: a
// token crosses the `src/components/ui/**` boundary that a feature import may
// not, and the colour inverts per theme like every other token. The fill is `fill-current`, so the
// one `text-rating` utility paints both outline and fill.
//
// This module holds a single constant, used only by `inbox-list-row.tsx`.
export const STAR_FILLED_CLASS = 'fill-current text-rating'
