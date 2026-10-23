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
//
// From 2026-10-23 Google also sends the original first, with no `(Original)`:
//   `<original>\n\n(Translated by Google)\n<translation>`
// Unsplit, that shape read as a guest edit: 59 closed-beta reviews whose Google
// updateTime had not moved reopened handled Inbox items and emailed the team.

/** The envelope Google prepends; the original text follows `ORIGINAL_MARKER`. */
const TRANSLATED_PREFIX = '(Translated by Google)'
const ORIGINAL_MARKER = '(Original)'
/**
 * The original-first envelope's delimiter: a blank line, then the marker on a
 * line of its own. A guest's own "(Translated by Google)" mid-sentence or on a
 * plain new line is not one. The line break that ends the marker line is a
 * lookahead, so two marker lines in a row are two matches.
 */
const TRANSLATION_LINE = /\r?\n[ \t]*\r?\n[ \t]*\(Translated by Google\)[ \t]*(?=\r?\n)/g

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
 * The original-first envelope splits on its LAST marker line, by the same
 * rule: a guest who wrote that exact line keeps every character in `original`.
 *
 * Only surrounding whitespace is trimmed; newlines inside either part survive.
 */
export function parseGoogleReviewComment(
  comment: string | null | undefined,
): GoogleReviewComment {
  if (comment == null) return { original: null, translation: null }
  const body = comment.trimStart()
  if (!body.startsWith(TRANSLATED_PREFIX)) {
    return splitOriginalFirst(comment)
  }
  const wrapped = body.slice(TRANSLATED_PREFIX.length)
  const marker = wrapped.indexOf(ORIGINAL_MARKER)
  if (marker < 0) return { original: null, translation: trimmedOrNull(wrapped) }
  return {
    original: trimmedOrNull(wrapped.slice(marker + ORIGINAL_MARKER.length)),
    translation: trimmedOrNull(wrapped.slice(0, marker)),
  }
}

function splitOriginalFirst(comment: string): GoogleReviewComment {
  const delimiter = [...comment.matchAll(TRANSLATION_LINE)].at(-1)
  if (delimiter === undefined)
    return { original: trimmedOrNull(comment), translation: null }
  // trimmedOrNull drops the marker line's own line break from the translation.
  return {
    original: trimmedOrNull(comment.slice(0, delimiter.index)),
    translation: trimmedOrNull(comment.slice(delimiter.index + delimiter[0].length)),
  }
}

export type GoogleReplyComment = Readonly<{
  /** The reply's own words, or null when there is no reply or none survive. */
  text: string | null
  /** A reply comment is present but carries no recoverable original text. */
  unreadable: boolean
}>

/**
 * Reads an echoed `reviews[].reviewReply.comment` without ever turning a reply
 * RepKey can't read into "no reply".
 *
 * `parseGoogleReviewComment` reports `original: null` for three different
 * provider facts: no comment, a blank comment, and a translation-only envelope
 * (`(Translated by Google) X` with no `(Original)` marker — see the
 * `marker < 0` branch above). For review text that is harmless. For a reply it
 * is not: reconciliation read `replyText: null` as "Google has no reply", so a
 * reply Google did show, in a form we could not read back, counted as absent
 * (google-review-api.adapter.ts `mapReview`). Absence is never evidence about a
 * publication, so the unreadable case is reported on its own.
 */
export function parseGoogleReplyComment(
  comment: string | null | undefined,
): GoogleReplyComment {
  if (comment == null) return { text: null, unreadable: false }
  const { original } = parseGoogleReviewComment(comment)
  return { text: original, unreadable: original === null }
}
