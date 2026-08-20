// Google's Business Profile API never returns the guest's own review text and
// Google's machine translation of it as two fields. It concatenates both into a
// single `reviews[].comment` string shaped exactly:
//   `(Translated by Google) <translation>\n\n(Original)\n<original>`
// 76 of the 93 texted reviews on the closed-beta property arrive wrapped that
// way and we stored the whole blob as the review text. Because Google sends no
// language field either (`reviews.language_code` was NULL for all 256 rows),
// local cld3 detection is the only language signal we have — and it was running
// over Google's ENGLISH translation glued to the guest's own words. Measured
// consequence: 8 Bulgarian reviews were judged "reliable English", which would
// have sent an English reply to a Bulgarian guest, and 8 genuinely repliable
// ru/tr/fr reviews were rejected because the mixed blob reads as unreliable.
// Splitting the envelope at the provider edge is what lets language detection —
// and therefore the whole AI reply plane — run on the original alone.

/** The envelope Google prepends; the original text follows `ORIGINAL_MARKER`. */
const TRANSLATED_PREFIX = '(Translated by Google)'
const ORIGINAL_MARKER = '(Original)'

export type GoogleReviewComment = Readonly<{
  original: string | null
  translation: string | null
}>

/** Surrounding whitespace is envelope framing (`\n\n`, `\n`), never content. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Splits a Google `reviews[].comment` into the guest's original text and
 * Google's machine translation.
 *
 * The prefix is only honoured at the start of the comment (after leading
 * whitespace): a guest who merely writes the words "(Translated by Google)"
 * mid-sentence must not have their review dissected.
 *
 * The FIRST `(Original)` after the prefix is the delimiter. Google emits the
 * marker immediately after the machine translation and exactly once, so the
 * first occurrence is the real one; any later literal `(Original)` in prose
 * stays inside `original`, which keeps every character of the guest's text —
 * the text language detection reads — intact. The reverse rule (last
 * occurrence) would move guest characters into `translation` and truncate the
 * detection input, so it is the strictly worse failure.
 *
 * Only surrounding whitespace is trimmed; newlines inside either part survive.
 */
export function parseGoogleReviewComment(
  comment: string | null | undefined,
): GoogleReviewComment {
  if (comment == null) return { original: null, translation: null }
  const body = comment.trimStart()
  if (!body.startsWith(TRANSLATED_PREFIX)) {
    return { original: trimmedOrNull(comment), translation: null }
  }
  const wrapped = body.slice(TRANSLATED_PREFIX.length)
  const marker = wrapped.indexOf(ORIGINAL_MARKER)
  if (marker < 0) return { original: null, translation: trimmedOrNull(wrapped) }
  return {
    original: trimmedOrNull(wrapped.slice(marker + ORIGINAL_MARKER.length)),
    translation: trimmedOrNull(wrapped.slice(0, marker)),
  }
}
