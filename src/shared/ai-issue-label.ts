// Anchored and evaluated only after the 40-character bound below; the repeated
// word group cannot receive attacker-controlled unbounded input.
// eslint-disable-next-line security/detect-unsafe-regex
export const AI_ISSUE_LABEL_PATTERN = /^[a-z]+(?: [a-z]+){0,3}$/
export const AI_ISSUE_LABEL_MAX_LENGTH = 40

/** The storage, read, and rendering boundary for model-authored issue labels. */
export function isAiIssueLabel(value: string): boolean {
  return value.length <= AI_ISSUE_LABEL_MAX_LENGTH && AI_ISSUE_LABEL_PATTERN.test(value)
}

/**
 * The consented merchant notice states the issue label "never reproduces
 * review text". `isAiIssueLabel` only enforces shape, and a lowercase excerpt
 * such as `worst hotel ever` satisfies it, so the claim rested entirely on a
 * prompt sentence. This is the structural half of it.
 *
 * A SINGLE word is a category, not an excerpt: `cleanliness` appears verbatim
 * in any review that complains about cleanliness, and rejecting it would
 * discard the discovery signal the open label exists to provide. Two or more
 * words appearing contiguously in the source is quotation, and is refused.
 *
 * Both sides are compared as words. A label holds only `a-z` and single
 * spaces, so a phrase copied from a review can never carry what touched it
 * there: the full stop or comma after it, a quotation mark, an accent, the
 * apostrophe in `didn't`. The review is therefore reduced to the words a label
 * could spell before matching, and both are space-padded so a match is whole
 * words in a row, never an incidental substring.
 *
 * Punctuation does not keep two words apart: `Dirty. Staff were kind` refuses
 * `dirty staff`. Telling a sentence break from a clause break would need a
 * grammar, and erring this way costs one optional label, never an excerpt.
 */
export function issueLabelReproducesSource(label: string, sourceText: string): boolean {
  const labelWords = wordsForComparison(label)
  if (labelWords.split(' ').length < 2) return false
  return ` ${wordsForComparison(sourceText)} `.includes(` ${labelWords} `)
}

const COMBINING_MARKS = /\p{M}+/gu
/**
 * The apostrophe inside a word, which a label drops: `didn't`, and the same
 * word typed with U+2019 (right single quotation mark) or U+02BC (modifier
 * letter apostrophe).
 */
const IN_WORD_APOSTROPHE = /(?<=\p{L})['\u2019\u02bc](?=\p{L})/gu
const NOT_A_WORD_CHARACTER = /[^\p{L}\p{N}]+/gu

/**
 * Lowercase words separated by single spaces: compatibility forms folded
 * (NFKD), diacritics removed, in-word apostrophes dropped, and every other run
 * that is not a letter or a digit read as one word break.
 */
function wordsForComparison(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(IN_WORD_APOSTROPHE, '')
    .replace(NOT_A_WORD_CHARACTER, ' ')
    .trim()
}
