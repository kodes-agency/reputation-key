// Inbox detail helpers — extracted from inbox-detail-sheet for line-count compliance.
//
// `RatingStars` used to live here and is deleted (plan row 7). The guest node
// renders the shared primitive instead — `#/components/ui/star-rating` — with
// `tone="rating"`, which resolves to the same `--rating` token. The primitive's
// DEFAULT tone stays foreground: its notification caller shows no number beside
// the glyphs, and gold against the empty glyph is far too low a ratio to carry
// a score alone on a light surface (the measurements are on `TONE_CLASS` in
// that file).
//
// Purple is reserved for interactive elements, so ratings use the `--rating`
// gold, which the property dashboard and the property list resolve to as well
// (v1 row 12). `STAR_FILLED_CLASS` survives for exactly one caller: the list
// row's `RowIdentity` (`inbox-list-row.tsx`), which draws ONE filled,
// `aria-hidden` star beside the rating. That star is an icon standing for
// "rating", not a rating out of one, and the primitive cannot express it:
// `max` is both the glyph count and the denominator, so `max={1}` would make
// the star a score out of one, and `showValue` would print `5.0` where the row
// prints the rating as it is. The row therefore keeps its own star and this
// class. Both
// now name the `--rating` CSS custom property rather than a raw `amber-400`: a
// token crosses the `src/components/ui/**` boundary that a feature import may
// not, so there is no literal left to keep in step, and the colour finally
// inverts per theme like every other token. The fill is `fill-current`, so the
// one `text-rating` utility paints both outline and fill.
//
// What is left is a single constant in a `.tsx` file that no longer holds JSX.
// Folding it into `inbox-list-row.tsx` (its only consumer) or into `utils.ts`
// and deleting this module is the obvious next move — but that is a rename
// across files this change does not own, so it is left to the integrator.
export const STAR_FILLED_CLASS = 'fill-current text-rating'
