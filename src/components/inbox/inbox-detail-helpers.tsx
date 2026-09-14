// Inbox detail helpers — extracted from inbox-detail-sheet for line-count compliance.
//
// `RatingStars` used to live here and is deleted (plan row 7). The guest node
// renders the shared primitive instead — `#/components/ui/star-rating` — with
// `tone="rating"`, which is the same amber literal. The primitive's DEFAULT
// tone stays foreground: its notification caller shows no number beside the
// glyphs, and amber-400 against the empty glyph is 1.08:1 on a light surface
// (the measurements are on `TONE_CLASS` in that file).
//
// Purple is reserved for interactive elements, so ratings use the amber the
// property dashboard already ships (v1 row 12). `STAR_FILLED_CLASS` survives
// for exactly one caller: the list row's `CompactRating`
// (`inbox-list-v2.tsx:19`), which draws ONE filled star beside `5.0`. That star
// is an icon standing for "rating", not a rating out of one, and the primitive
// cannot express it: `max` is both the glyph count and the denominator of the
// accessible sentence, so `<StarRating max={1} value={5} showValue />` would
// draw the same pixels while announcing "5.0 out of 1 stars" where the row must
// keep saying "5 out of 5 stars". The row therefore keeps its own star and this
// class, and the primitive keeps its own copy of the literal —
// `src/components/ui/**` may not import a feature module, so the duplication is
// the boundary's price, not an oversight.
//
// What is left is a single constant in a `.tsx` file that no longer holds JSX.
// Folding it into `inbox-list-v2.tsx` (its only consumer) or into `utils.ts`
// and deleting this module is the obvious next move — but that is a rename
// across files this change does not own, so it is left to the integrator.
export const STAR_FILLED_CLASS = 'fill-amber-400 text-amber-400'
