// Google's display name for a location's primary category ("Hotel", "Italian
// restaurant"), the form it is stored in and the form it is looked up by.
//
// The category is a hint: it picks the vocabulary a review analysis is steered
// with (`review-vocabulary-hints.ts`) and is never shown as a venue type
// (docs/BETA.md §3). So a value that is not usable text is dropped to null
// rather than repaired or truncated: no category is a normal state and falls
// back to the generic vocabulary.

/** `properties.google_primary_category` is a varchar(512). */
export const GOOGLE_PRIMARY_CATEGORY_MAX_LENGTH = 512

const WHITESPACE_RUN = /\s+/gu
// Control, format, private-use and unassigned code points are not text a
// category can be made of.
const UNUSABLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u

/**
 * NFKC, runs of whitespace as one space, trimmed. Null for an empty value, one
 * with characters that are not text, or one longer than the column holds.
 * Idempotent, so every layer that touches the value may apply it again.
 */
export function normalizeGooglePrimaryCategory(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').replace(WHITESPACE_RUN, ' ').trim()
  if (normalized.length === 0) return null
  if ([...normalized].length > GOOGLE_PRIMARY_CATEGORY_MAX_LENGTH) return null
  if (UNUSABLE_CHARACTER.test(normalized)) return null
  return normalized
}
